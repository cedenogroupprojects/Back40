// Today list ranking: who gets on the hot sheet, in what order, and why.
//
// Locked decisions (Nov 7):
// - One ranked list, no section headings.
// - Brand-new uncontacted leads always sit at the top.
// - Cap of ~10 leads; overflow lives in the Leads tab.
// - "Going cold" = 2 days untouched, same for everyone.
// - Agents can pin any lead onto Today.
//
// This is the deterministic baseline. The AI pipeline can nudge `heat`
// (+/- 15) and write the why-now line, but the rules here decide eligibility,
// so the list is explainable and works even if the AI is down.

import type { HotRules, Lead, LeadLabel, RankedLead } from './types.ts';
import { classifyStage } from './pipeline.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const DEFAULT_RULES: HotRules = {
  hotStages: ['New Lead', 'Pre-Approved', 'Actively Looking', 'Submitting Offers'],
  goingColdDays: 2,
  cap: 10,
};

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function isBrandNew(lead: Lead, now: number): boolean {
  return !lead.lastContactAt && now - t(lead.createdAt) < 7 * DAY;
}

export function isHotStage(lead: Lead, rules: HotRules): boolean {
  const s = lead.stage.toLowerCase();
  return rules.hotStages.some((h) => h.toLowerCase() === s);
}

export function daysSinceContact(lead: Lead, now: number): number {
  const last = t(lead.lastContactAt);
  if (Number.isNaN(last)) return Infinity;
  return (now - last) / DAY;
}

export function followUpDue(lead: Lead, now: number): boolean {
  const due = t(lead.nextFollowUpAt);
  if (Number.isNaN(due)) return false;
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due <= endOfToday.getTime();
}

export function recentSignals(lead: Lead, now: number, withinHours: number): number {
  return lead.signals.filter((s) => now - t(s.at) <= withinHours * HOUR).length;
}

/** 0-100. Higher = call sooner. */
export function heatScore(lead: Lead, rules: HotRules, now: number): number {
  let h = 0;
  if (isBrandNew(lead, now)) {
    const ageH = (now - t(lead.createdAt)) / HOUR;
    h += ageH < 1 ? 60 : ageH < 24 ? 50 : 40;
  }
  if (isHotStage(lead, rules)) h += 30;
  h += Math.min(30, recentSignals(lead, now, 24) * 12 + recentSignals(lead, now, 72) * 4);
  if (followUpDue(lead, now)) h += 15;
  if (lead.promiseNote && followUpDue(lead, now)) h += 10;
  const days = daysSinceContact(lead, now);
  if (isHotStage(lead, rules) && Number.isFinite(days) && days >= rules.goingColdDays) {
    h += Math.min(20, Math.round(days * 2));
  }
  if (lead.fields.preApproved) h += 8;
  if (lead.pinned) h += 5;
  return Math.max(0, Math.min(100, Math.round(h)));
}

export function labelFor(lead: Lead, rules: HotRules, now: number): LeadLabel {
  if (isBrandNew(lead, now)) return 'brand_new';
  if (lead.promiseNote && followUpDue(lead, now)) return 'promised';
  if (!isHotStage(lead, rules) && recentSignals(lead, now, 48) > 0) return 'back_again';
  if (isHotStage(lead, rules) && daysSinceContact(lead, now) >= rules.goingColdDays && recentSignals(lead, now, 24) === 0)
    return 'slipping';
  if (isHotStage(lead, rules) && recentSignals(lead, now, 72) > 0) return 'hot_now';
  if (followUpDue(lead, now)) return 'follow_up';
  if (lead.pinned) return 'pinned';
  // In play and recently worked. Not urgent, so it doesn't count as hot.
  return 'working';
}

export const LABEL_TEXT: Record<LeadLabel, string> = {
  brand_new: 'Brand new lead',
  hot_now: 'Hot right now',
  working: 'In your pipeline',
  promised: 'You promised a call',
  follow_up: 'Follow up today',
  slipping: 'Slipping away',
  back_again: 'Back on the market',
  pinned: 'Pinned by you',
};

function fallbackReason(lead: Lead, label: LeadLabel, now: number): string {
  switch (label) {
    case 'brand_new': {
      const mins = Math.round((now - t(lead.createdAt)) / 60000);
      const ago = mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
      return `New lead ${ago}. Nobody has called yet.`;
    }
    case 'promised':
      return `You told them: "${lead.promiseNote}".`;
    case 'slipping':
      return `No contact in ${Math.floor(daysSinceContact(lead, now))} days.`;
    case 'back_again':
    case 'hot_now': {
      const s = lead.signals[0];
      return s?.detail ?? 'Recent activity in your CRM.';
    }
    case 'follow_up':
      return 'Follow-up is due today.';
    case 'working':
      return `${lead.stage}. Last contact ${Math.max(0, Math.round(daysSinceContact(lead, now)))} days ago.`;
    default:
      return 'You pinned this lead.';
  }
}

export function isEligible(lead: Lead, rules: HotRules, now: number): boolean {
  if (lead.pinned || isBrandNew(lead, now) || followUpDue(lead, now)) return true;
  if (isHotStage(lead, rules)) return true;
  return recentSignals(lead, now, 48) > 0; // Back 40 sweep
}

/** Build the Today list: one ranked list, brand-new first, capped. */
function rankEligible(leads: Lead[], rules: HotRules, now: number): RankedLead[] {
  return leads
    .filter((l) => isEligible(l, rules, now))
    .map((lead) => {
      const label = labelFor(lead, rules, now);
      return { lead, heat: heatScore(lead, rules, now), label, reason: lead.aiWhyNow ?? fallbackReason(lead, label, now) };
    });
}

const HOT_LABELS: LeadLabel[] = ['brand_new', 'hot_now', 'promised', 'slipping'];

/**
 * The Leads tab: only people worth staying in front of. Everyone else (nurture,
 * past clients, cold leads) stays in the CRM and is reachable by search.
 * Hot = new, active, promised or slipping. Warm = follow-ups, people back on the
 * market, and pins.
 */
export function hotAndWarm(leads: Lead[], rules: HotRules = DEFAULT_RULES, now = Date.now()): { hot: RankedLead[]; warm: RankedLead[] } {
  const all = rankEligible(leads, rules, now).sort((a, b) => b.heat - a.heat);
  const isHot = (r: RankedLead) => HOT_LABELS.includes(r.label) || r.heat >= 60;
  return { hot: all.filter(isHot), warm: all.filter((r) => !isHot(r)) };
}

export function rankToday(leads: Lead[], rules: HotRules = DEFAULT_RULES, now = Date.now(), extra = 0): RankedLead[] {
  const ranked = rankEligible(leads, rules, now);

  // Add, never take: brand-new leads and anyone who just engaged (replied, opened
  // a home, watched a video in the last day) always get a card, even past the cap.
  const engaged = (r: RankedLead) => r.label === 'brand_new' || recentSignals(r.lead, now, 24) > 0;
  const brandNew = ranked
    .filter(engaged)
    .sort((a, b) => Number(b.label === 'brand_new') - Number(a.label === 'brand_new') || t(b.lead.createdAt) - t(a.lead.createdAt));
  const rest = ranked.filter((r) => !engaged(r)).sort((a, b) => b.heat - a.heat);

  // Brand-new and pinned leads are guaranteed a spot; others fill up to the cap.
  const cap = rules.cap + extra;
  const out: RankedLead[] = [...brandNew];
  for (const r of rest) {
    if (out.length < cap || r.lead.pinned) out.push(r);
  }
  // Always a full list: top up with the best of everyone else still in play
  // (not closed or dead, not reached in the last day), CRM score first, then
  // whoever has gone longest without hearing from us.
  if (out.length < cap) {
    const taken = new Set(out.map((r) => r.lead.id));
    const filler = leads
      .filter((l) => !taken.has(l.id) && classifyStage(l.stage).kind === 'active' && daysSinceContact(l, now) >= 1 && !(l.fields.doNotCall && l.fields.doNotText))
      .sort((a, b) => (b.fields.crmScore ?? 0) - (a.fields.crmScore ?? 0) || Math.min(daysSinceContact(b, now), 9999) - Math.min(daysSinceContact(a, now), 9999))
      .slice(0, cap - out.length)
      .map((lead) => {
        const label = labelFor(lead, rules, now);
        return { lead, heat: heatScore(lead, rules, now), label, reason: lead.aiWhyNow ?? fallbackReason(lead, label, now) };
      });
    out.push(...filler);
  }
  return out;
}

/** Hot leads nobody has touched in `goingColdDays` (for the Team alert). */
export function staleHotLeads(leads: Lead[], rules: HotRules = DEFAULT_RULES, now = Date.now()): Lead[] {
  return leads.filter(
    (l) => (isHotStage(l, rules) || isBrandNew(l, now)) && (daysSinceContact(l, now) >= rules.goingColdDays || (isBrandNew(l, now) && now - t(l.createdAt) > rules.goingColdDays * DAY)),
  );
}
