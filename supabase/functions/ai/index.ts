// POST /ai — every AI feature goes through this one function so guardrails,
// model choice, cost limits and logging live in one place.
//
// tasks:
//   why_now  — one-line reason + opener for a lead (runs on sync + each morning)
//   summary  — the collapsed 2-line lead summary
//   extract  — voice transcript → clean note + fields + follow-up + stage (shown for confirm)
//   draft    — text/email in the agent's voice for a play (lands in the Approve stack)
//   ask      — Ask Back 40 question about one lead
//
// Guardrails (spec §9): facts only from the record; never invent prices, dates,
// homes or promises; fair-housing safe; nothing is sent without approval.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, serviceClient } from '../_shared/db.ts';

const FAST = Deno.env.get('AI_MODEL_FAST') ?? 'claude-haiku-5-5';   // ranking lines, notes
const SMART = Deno.env.get('AI_MODEL_SMART') ?? 'claude-sonnet-5-5'; // drafts, ask
const DAILY_CALL_CAP = Number(Deno.env.get('AI_DAILY_CALLS_PER_USER') ?? 300);

const GUARDRAILS = `You are Back 40, an assistant for real estate agents.
Rules:
- Use ONLY facts in the LEAD RECORD below. If something isn't there, say you don't know. Never invent prices, dates, addresses, homes, or promises.
- Fair housing: never describe or steer by race, religion, national origin, sex, disability, familial status or other protected traits; never describe neighborhoods by who lives there.
- Be brief, warm and plain-spoken, like a good agent texting a client.`;

type Task = 'why_now' | 'summary' | 'extract' | 'draft' | 'ask';

async function callModel(model: string, system: string, user: string, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: Math.max(maxTokens * 8, 4000), system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`model ${res.status}`);
  const out = await res.json();
  return { text: ((out.content ?? []) as { type?: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'), usage: out.usage as { input_tokens: number; output_tokens: number } };
}

function record(lead: Record<string, unknown>, timeline: Record<string, unknown>[]) {
  const lines = timeline.map((t) => `- ${String(t.at).slice(0, 10)} ${t.kind}: ${t.title}${t.body ? ` — ${t.body}` : ''}`).join('\n');
  return `LEAD RECORD
Name: ${lead.first_name} ${lead.last_name}
Stage: ${lead.stage}
Source: ${lead.source ?? 'unknown'}
Tags: ${(lead.tags as string[] | null)?.join(', ') || 'none'}
Known fields: ${JSON.stringify(lead.fields ?? {})}
Recent activity: ${JSON.stringify(lead.signals ?? [])}
Last contact: ${lead.last_contact_at ?? 'never'}
History (newest first):
${lines || '- none'}`;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const isServer = auth === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  const body = (await req.json()) as { task: Task; leadId: string; play?: string; transcript?: string; question?: string; channel?: 'text' | 'email' };

  // Users go through RLS; the server (sync worker) uses the service client.
  const db = isServer
    ? serviceClient()
    : createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: lead } = await db.from('leads').select('*').eq('id', body.leadId).maybeSingle();
  if (!lead) return json({ error: 'not found' }, 404);
  const { data: timeline } = await db.from('timeline_items').select('at, kind, title, body').eq('lead_id', lead.id).order('at', { ascending: false }).limit(30);
  const userId = lead.assigned_user_id as string;

  // Cost guardrail: per-user daily cap.
  const admin = serviceClient();
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin.from('ai_usage').select('calls').eq('user_id', userId).eq('day', day).maybeSingle();
  if ((usage?.calls ?? 0) >= DAILY_CALL_CAP) return json({ error: 'daily AI limit reached' }, 429);

  const rec = record(lead, timeline ?? []);
  let model = FAST;
  let prompt = '';
  let maxTokens = 300;
  switch (body.task) {
    case 'why_now':
      prompt = `${rec}\n\nReturn JSON {"whyNow": one sentence (max 18 words) on why to call today, "opener": a natural first line for the call}. Facts only.`;
      break;
    case 'summary':
      prompt = `${rec}\n\nSummarize in 2-3 short sentences: what they want, budget, timeline, last promise made. Facts only.`;
      break;
    case 'extract':
      prompt = `${rec}\n\nAGENT'S VOICE NOTE AFTER THE CALL:\n"${body.transcript ?? ''}"\n\nReturn JSON {"note": clean 1-3 sentence note, "fields": {budgetMax?, downPayment?, timeline?, beds?, areas?, preApproved?} ONLY if stated in the voice note, "followUpAt": ISO date if a day was mentioned else null, "stageChange": suggested stage or null, "recap": a short friendly text to send the lead or null}.`;
      break;
    case 'draft':
      model = SMART;
      prompt = `${rec}\n\nWrite a ${body.channel ?? 'text'} for the play "${body.play}". Under 320 characters for texts. Sound like the agent. Return JSON {"body": "...", "subject": email subject or null, "why": one sentence explaining why this message now}.`;
      break;
    case 'ask':
      model = SMART;
      maxTokens = 500;
      prompt = `${rec}\n\nQUESTION: ${body.question}\n\nAnswer in 1-3 sentences and cite the history line you used (date + kind). If it's not in the record, say so.`;
      break;
    default:
      return json({ error: 'task' }, 400);
  }

  const { text, usage: u } = await callModel(model, GUARDRAILS, prompt, maxTokens);
  await admin.from('ai_usage').upsert(
    { org_id: lead.org_id, user_id: userId, day, calls: (usage?.calls ?? 0) + 1, input_tokens: u.input_tokens, output_tokens: u.output_tokens },
    { onConflict: 'user_id,day' },
  );

  const parsed = (() => { try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; } })();

  if (body.task === 'why_now' && parsed) {
    await admin.from('leads').update({ ai_why_now: parsed.whyNow, ai_opener: parsed.opener, ai_updated_at: new Date().toISOString() }).eq('id', lead.id);
  }
  if (body.task === 'summary') {
    await admin.from('leads').update({ ai_summary: text.trim(), ai_updated_at: new Date().toISOString() }).eq('id', lead.id);
  }
  if (body.task === 'draft' && parsed) {
    await admin.from('drafts').insert({
      org_id: lead.org_id, lead_id: lead.id, user_id: userId, channel: body.channel ?? 'text', play: body.play ?? 'ask',
      subject: parsed.subject ?? null, body: parsed.body, why: parsed.why, status: 'pending',
    });
  }
  return json({ ok: true, result: parsed ?? text.trim() });
});
