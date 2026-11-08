// Demo stand-ins for the AI calls. In production these go to the `ai` Edge
// Function (supabase/functions/ai); the shapes match so swapping is one line.
import type { Lead, LeadFields } from '@back40/core';

export type Extraction = { note: string; fields: Partial<LeadFields>; followUpDay: string | null; stageChange: string | null; recap: string | null };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Pulls facts out of a voice note. Only what was actually said. */
export function extractFromNote(transcript: string, lead: Lead): Extraction {
  const t = transcript.toLowerCase();
  const fields: Partial<LeadFields> = {};
  const money = transcript.match(/\$\s?(\d{3})\s?k/i) ?? transcript.match(/\$\s?(\d{3}),?000/);
  if (money) fields.budgetMax = Number(money[1]) * 1000;
  const beds = t.match(/(\d)\s?(bed|bedroom)/);
  if (beds) fields.beds = Number(beds[1]);
  if (/pre-?approv/.test(t)) fields.preApproved = true;
  const day = DAYS.find((d) => t.includes(d)) ?? (t.includes('tomorrow') ? 'tomorrow' : null);
  const touring = /tour|walk|show(ing)?/.test(t);
  return {
    note: transcript.trim().replace(/^./, (c) => c.toUpperCase()),
    fields,
    followUpDay: day,
    stageChange: touring && lead.stage !== 'Touring' ? 'Touring' : null,
    recap: touring && day ? `Great talking today, ${lead.firstName}! See you ${day[0]!.toUpperCase()}${day.slice(1)}.` : null,
  };
}

export const SAMPLE_TRANSCRIPT: Record<string, string> = {
  marisol: 'Touring Saturday at 11 with her sister. Single story, 4 bed.',
  james: 'Wants move-in ready, 3 bed, pre-approved already. Call back tomorrow with options.',
  priya: 'Wants to see the corner lot again with Dev on Sunday.',
  tony: 'Budget up to $720K, wants to tour Thursday.',
};

/** Ask Back 40, answered only from the record. */
export function answer(question: string, leads: Lead[]): { text: string; source?: string } {
  const q = question.toLowerCase();
  const who = leads.find((l) => q.includes(l.firstName.toLowerCase()));
  if (q.includes('first') || q.includes('call next')) {
    return { text: 'Start with James Carter (brand new, nobody has called), then Marisol Vega (looked at 3 homes last night).' };
  }
  if (who && q.includes('budget')) {
    const b = who.fields.budgetMax;
    return b
      ? { text: `${who.firstName} said up to $${Math.round(b / 1000)}K${who.fields.downPayment ? ` with $${Math.round(who.fields.downPayment / 1000)}K down` : ''}.`, source: 'From your call note' }
      : { text: `I don't see a budget for ${who.firstName} in your notes yet.` };
  }
  if (who) return { text: who.aiSummary ?? who.aiWhyNow ?? `I don't have much on ${who.firstName} yet.`, source: 'From the lead record' };
  if (q.includes('how am i') || q.includes('week')) return { text: 'You’ve made 32 calls this week, up 9 from last week, and you’re on a 5-day streak.' };
  return { text: 'I can answer questions about your leads, draft texts, and set reminders. Try "What did Tony say about his budget?"' };
}
