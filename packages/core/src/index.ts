export * from './types.ts';
export * from './ranking.ts';
export * from './score.ts';
export * from './pipeline.ts';
export * from './nurture.ts';
export * from './crm/adapter.ts';
export { lofty, mapLoftyLead, loftySearchListings, type ListingCriteria } from './crm/lofty.ts';
export { followUpBoss, mapFubPerson } from './crm/followupboss.ts';
export { goHighLevel, mapGhlContact } from './crm/gohighlevel.ts';

import { lofty } from './crm/lofty.ts';
import { followUpBoss } from './crm/followupboss.ts';
import { goHighLevel } from './crm/gohighlevel.ts';
import type { CrmAdapter } from './crm/adapter.ts';
import type { CrmKind } from './types.ts';

export const ADAPTERS: Record<CrmKind, CrmAdapter> = {
  lofty,
  followupboss: followUpBoss,
  gohighlevel: goHighLevel,
};
