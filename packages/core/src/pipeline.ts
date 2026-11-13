// The pipeline board mirrors each team's own CRM stages, with their names.
// Every CRM (and every team) names stages differently, so Back 40 doesn't impose
// its own columns. It reads the stages the team actually uses, sorts them into a
// sensible order (new → contacted → appointment → lender → showing → offer →
// escrow), and leaves done/dead stages (Closed, Bad Leads, Do Not Contact) off
// the board. Moving a card writes that exact stage back to the CRM.
import type { Lead } from './types.ts';

export type BucketId = string;
export interface Bucket {
  id: BucketId;
  /** What the column is called: the CRM's own stage name. */
  label: string;
  /** CRM stage this column reads from and writes to. */
  stage: string;
}

export type StageKind = 'active' | 'done' | 'dead';
export type StageInfo = { phase: number; kind: StageKind; hot: boolean };

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage';

/**
 * Where a stage sits in a buyer's journey, from its name alone. Works across
 * Lofty, Follow Up Boss and GoHighLevel naming. Unknown names land mid-funnel.
 */
export function classifyStage(name: string): StageInfo {
  const s = name.trim().toLowerCase();
  if (/(bad lead|junk|spam|trash|do not contact|\bdnc\b|not interested|unqualified|\blost\b|dead|archiv|invalid|wrong number|duplicate)/.test(s))
    return { phase: 99, kind: 'dead', hot: false };
  if (/(closed|\bsold\b|already bought|bought elsewhere|past client|sphere)/.test(s) || /^(agents?|lenders?|vendors?|realtors?|partners?)$/.test(s))
    return { phase: 98, kind: 'done', hot: false };
  if (/(escrow|under contract|in contract|pending|closing)/.test(s)) return { phase: 7, kind: 'active', hot: false };
  if (/(offer|negotiat|submitted)/.test(s)) return { phase: 6, kind: 'active', hot: true };
  if (/(showing|looking|tour|active buyer|searching|house hunting)/.test(s)) return { phase: 5, kind: 'active', hot: true };
  if (/(lender|pre-?qual|pre-?approv|financ|loan)/.test(s)) return { phase: 4, kind: 'active', hot: true };
  if (/(appoint|scheduled|consult|meeting|\bmet\b)/.test(s)) return { phase: 3, kind: 'active', hot: true };
  // Follow Up Boss "Hot Prospect", GoHighLevel "Hot Lead"/"Active Client" style names.
  if (/(\bhot\b|active client|active buyer)/.test(s)) return { phase: 3, kind: 'active', hot: true };
  if (/(nurtur|long[- ]term|drip|future|watch)/.test(s)) return { phase: 2.5, kind: 'active', hot: false };
  if (/(attempt|no answer|unresponsive|voicemail|left vm)/.test(s)) return { phase: 1, kind: 'active', hot: false };
  if (/(contact|engaged|talking|responded|spoke|warm|qualified)/.test(s)) return { phase: 2, kind: 'active', hot: false };
  if (/(new|fresh|incoming|unassigned|lead$|leads$)/.test(s)) return { phase: 0, kind: 'active', hot: true };
  return { phase: 2.7, kind: 'active', hot: false };
}

/** The board for a team, from the stages its leads are in (with how many in each). */
export function buildPipeline(stages: { stage: string; n?: number }[]): Bucket[] {
  const seen = new Map<string, { stage: string; n: number }>();
  for (const { stage, n } of stages) {
    const name = stage?.trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const prev = seen.get(k);
    seen.set(k, { stage: prev?.stage ?? name, n: (prev?.n ?? 0) + (n ?? 1) });
  }
  return [...seen.values()]
    .map((x) => ({ ...x, info: classifyStage(x.stage) }))
    .filter((x) => x.info.kind === 'active')
    .sort((a, b) => a.info.phase - b.info.phase || b.n - a.n || a.stage.localeCompare(b.stage))
    .map((x) => ({ id: slug(x.stage), label: x.stage, stage: x.stage }));
}

/** Stages Back 40 treats as hot by default: new, appointments, lender, showing, offers. */
export function defaultHotStages(stages: string[]): string[] {
  return stages.filter((s) => classifyStage(s).hot);
}

/** Every stage worth offering in a stage picker: the board first, then done/dead ones. */
export function stageOptions(stages: string[]): string[] {
  const uniq = [...new Map(stages.filter(Boolean).map((s) => [s.trim().toLowerCase(), s.trim()])).values()];
  return uniq.sort((a, b) => classifyStage(a).phase - classifyStage(b).phase || a.localeCompare(b));
}

/** Used for sample data and teams that haven't connected a CRM yet. */
export const PIPELINE: Bucket[] = [
  { id: 'new', label: 'New Lead', stage: 'New Lead' },
  { id: 'contacted', label: 'Contacted', stage: 'Contacted' },
  { id: 'lender', label: 'Sent to Lender', stage: 'Sent to Lender' },
  { id: 'preapproved', label: 'Pre-Approved', stage: 'Pre-Approved' },
  { id: 'looking', label: 'Actively Looking', stage: 'Actively Looking' },
  { id: 'offers', label: 'Submitting Offers', stage: 'Submitting Offers' },
  { id: 'escrow', label: 'In Escrow', stage: 'In Escrow' },
];

export function bucketFor(lead: Pick<Lead, 'stage'>, pipeline: Bucket[] = PIPELINE): BucketId | null {
  const s = lead.stage.trim().toLowerCase();
  return pipeline.find((b) => b.stage.toLowerCase() === s)?.id ?? null;
}

/** Leads grouped by column, in board order. Leads in done/dead stages are left off. */
export function groupByBucket<T extends Pick<Lead, 'stage'>>(leads: T[], pipeline: Bucket[] = PIPELINE): Record<BucketId, T[]> {
  const out = Object.fromEntries(pipeline.map((b) => [b.id, [] as T[]])) as Record<BucketId, T[]>;
  for (const l of leads) {
    const b = bucketFor(l, pipeline);
    if (b) out[b]!.push(l);
  }
  return out;
}
