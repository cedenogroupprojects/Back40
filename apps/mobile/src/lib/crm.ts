import type { CrmKind } from '@back40/core';

export const CRM_NAME: Record<CrmKind, string> = { lofty: 'Lofty', followupboss: 'Follow Up Boss', gohighlevel: 'GoHighLevel' };

/** Follow Up Boss's API can't send texts/emails → fall back to the phone + log it. */
export const CRM_CAN_SEND: Record<CrmKind, boolean> = { lofty: true, followupboss: false, gohighlevel: true };
