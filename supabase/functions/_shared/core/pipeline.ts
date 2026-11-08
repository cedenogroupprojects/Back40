// The pipeline board: the steps a buyer moves through, from first contact to escrow.
// Each bucket is backed by a CRM stage, so dragging a card writes the stage
// back to Lofty / Follow Up Boss / GoHighLevel. Teams can rename the stage a
// bucket points at (e.g. "Under Contract" instead of "In Escrow") in settings.
import type { Lead } from './types.ts';

export type BucketId = 'new' | 'contacted' | 'lender' | 'preapproved' | 'looking' | 'offers' | 'escrow';
export interface Bucket {
  id: BucketId;
  label: string;
  /** CRM stage this bucket reads from and writes to. Lofty caps stage names at 19 characters. */
  stage: string;
}

export const PIPELINE: Bucket[] = [
  { id: 'new', label: 'New', stage: 'New Lead' },
  { id: 'contacted', label: 'Contacted', stage: 'Contacted' },
  { id: 'lender', label: 'Sent to lender', stage: 'Sent to Lender' },
  { id: 'preapproved', label: 'Pre-approved', stage: 'Pre-Approved' },
  { id: 'looking', label: 'Actively looking', stage: 'Actively Looking' },
  { id: 'offers', label: 'Submitting offers', stage: 'Submitting Offers' },
  { id: 'escrow', label: 'In escrow', stage: 'In Escrow' },
];

export function bucketFor(lead: Pick<Lead, 'stage'>, pipeline: Bucket[] = PIPELINE): BucketId | null {
  const s = lead.stage.trim().toLowerCase();
  return pipeline.find((b) => b.stage.toLowerCase() === s)?.id ?? null;
}

/** Leads grouped by bucket, in pipeline order. Leads in other stages (nurture, past client) are left off. */
export function groupByBucket<T extends Pick<Lead, 'stage'>>(leads: T[], pipeline: Bucket[] = PIPELINE): Record<BucketId, T[]> {
  const out = Object.fromEntries(pipeline.map((b) => [b.id, [] as T[]])) as Record<BucketId, T[]>;
  for (const l of leads) {
    const b = bucketFor(l, pipeline);
    if (b) out[b].push(l);
  }
  return out;
}
