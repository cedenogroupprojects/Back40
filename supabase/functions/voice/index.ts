// POST /voice  { text }  →  { url }
// Turns the morning briefing (or any short script) into natural, human-sounding
// audio with ElevenLabs. Phone text-to-speech sounds robotic; this doesn't.
//
// Cost control: audio is cached in Storage by a hash of (voice, model, text), so
// the same briefing never gets generated twice, and each user has a daily cap.
//
// Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (pick one in the ElevenLabs voice
// library), ELEVENLABS_MODEL (default eleven_multilingual_v2: best quality;
// eleven_flash_v2_5 is half the price and faster), VOICE_DAILY_PER_USER (default 10).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, serviceClient } from '../_shared/db.ts';

const KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const VOICE = Deno.env.get('ELEVENLABS_VOICE_ID') ?? '';
const MODEL = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2';
const CAP = Number(Deno.env.get('VOICE_DAILY_PER_USER') ?? 10);
const MAX_CHARS = 2500; // about 2.5 minutes of speech

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!KEY || !VOICE) return json({ error: 'voice not configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: uid } = await userDb.rpc('uid');
  if (!uid) return json({ error: 'auth' }, 401);

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return json({ error: 'text' }, 400);
  const clean = text.trim().slice(0, MAX_CHARS);

  const db = serviceClient();
  const path = `${await sha256(`${VOICE}|${MODEL}|${clean}`)}.mp3`;
  const signed = async () => (await db.storage.from('voice').createSignedUrl(path, 60 * 60)).data?.signedUrl;

  // Cached already? Free.
  const hit = await db.storage.from('voice').list('', { search: path, limit: 1 });
  if (hit.data?.some((f) => f.name === path)) return json({ url: await signed(), cached: true });

  // Daily cap per user (ai_usage.voice_calls).
  const day = new Date().toISOString().slice(0, 10);
  const { data: used } = await db.from('ai_usage').select('voice_calls').eq('user_id', uid).eq('day', day).maybeSingle();
  if ((used?.voice_calls ?? 0) >= CAP) return json({ error: 'daily voice limit reached' }, 429);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: clean,
      model_id: MODEL,
      // Lower stability = more natural, varied delivery; style adds warmth.
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) return json({ error: `voice provider ${res.status}` }, 502);

  await db.storage.from('voice').upload(path, await res.arrayBuffer(), { contentType: 'audio/mpeg', upsert: true });
  if (used) {
    await db.from('ai_usage').update({ voice_calls: used.voice_calls + 1 }).eq('user_id', uid).eq('day', day);
  } else {
    const { data: m } = await db.from('members').select('org_id').eq('user_id', uid).limit(1).maybeSingle();
    if (m) await db.from('ai_usage').insert({ org_id: m.org_id, user_id: uid, day, voice_calls: 1 });
  }
  return json({ url: await signed(), cached: false });
});
