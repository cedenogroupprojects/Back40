// How a lead's status shows up: a small colored dot plus a few words.
// Orange = hot, blue = you promised / follow-up, amber = back looking, gray = going cold.
import type { Lead, LeadLabel } from '@back40/core';

import type { Palette } from '@/theme/tokens';

export const STATUS_TEXT: Record<LeadLabel, string> = {
  brand_new: 'New lead',
  hot_now: 'Hot',
  promised: 'Promised',
  follow_up: 'Follow up',
  slipping: 'Going cold',
  back_again: 'Back looking',
  pinned: 'Pinned',
  working: 'Working',
};

export function statusColor(label: LeadLabel, c: Palette): string {
  switch (label) {
    case 'brand_new':
    case 'hot_now':
      return c.accent;
    case 'promised':
    case 'follow_up':
      return c.cool;
    case 'back_again':
      return c.warm;
    default:
      return c.sub;
  }
}

/** "14m", "3h", "2d" since the lead's latest activity. */
export function since(lead: Lead, now = Date.now()): string {
  const times = [lead.lastContactAt, ...lead.signals.map((s) => s.at), lead.lastContactAt ? null : lead.createdAt]
    .filter(Boolean)
    .map((x) => Date.parse(x as string));
  const t = Math.max(...times, 0);
  if (!t) return '';
  const m = Math.max(1, Math.round((now - t) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
