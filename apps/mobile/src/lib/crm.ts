import type { CrmKind, LeadSourceKind } from '@back40/core';

export const CRM_NAME: Record<CrmKind, string> = { lofty: 'Lofty', followupboss: 'Follow Up Boss', gohighlevel: 'GoHighLevel' };

/** Where a lead's changes get saved. Hand-added leads live in Back 40 only. */
export const SOURCE_NAME: Record<LeadSourceKind, string> = { ...CRM_NAME, manual: 'Back 40' };

/** Follow Up Boss's API can't send texts/emails → fall back to the phone + log it. */
export const CRM_CAN_SEND: Record<LeadSourceKind, boolean> = { lofty: true, followupboss: false, gohighlevel: true, manual: false };
