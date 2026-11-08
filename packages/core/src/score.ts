// Daily score + streak. Decision: every attempt earns points, a real
// conversation earns more, so agents get credit for effort.

import type { CallOutcome } from './types.ts';

export const OUTCOME_POINTS: Record<CallOutcome, number> = {
  talked: 8,
  voicemail: 3,
  no_answer: 2,
  attempted: 2,
};

/** Bonus for reaching a brand-new lead within 15 minutes. */
export const SPEED_BONUS = 4;

export interface DayActivity {
  date: string; // YYYY-MM-DD (agent's local date)
  calls: { outcome: CallOutcome; speedToLead?: boolean }[];
  staleHotLeads: number; // hot leads left untouched past the going-cold window
}

export function pointsFor(outcome: CallOutcome, speedToLead = false): number {
  return OUTCOME_POINTS[outcome] + (speedToLead ? SPEED_BONUS : 0);
}

/**
 * 0-100. Hitting the daily goal with every call a real conversation = 100.
 * Each hot lead left to go cold costs 5.
 */
export function dailyScore(day: DayActivity, dailyGoal: number): number {
  const goal = Math.max(1, dailyGoal);
  const points = day.calls.reduce((sum, c) => sum + pointsFor(c.outcome, c.speedToLead), 0);
  const raw = (100 * points) / (goal * OUTCOME_POINTS.talked) - 5 * day.staleHotLeads;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Consecutive days (ending today, or yesterday if today isn't done) where calls >= goal. */
export function streak(days: DayActivity[], dailyGoal: number, today: string): number {
  const byDate = new Map(days.map((d) => [d.date, d.calls.length]));
  const cursor = new Date(`${today}T12:00:00Z`);
  const key = () => cursor.toISOString().slice(0, 10);
  if ((byDate.get(key()) ?? 0) < dailyGoal) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let n = 0;
  while ((byDate.get(key()) ?? 0) >= dailyGoal) {
    n += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return n;
}
