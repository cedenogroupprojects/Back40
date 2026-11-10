// The contract every CRM integration implements. Adding a new CRM later means
// writing one more file that satisfies this interface — nothing else changes.
//
// Adapters are pure HTTP + mapping. They never touch our database and never
// retry on their own: the sync worker owns queuing, retries, rate limits and
// idempotency so behaviour is identical across CRMs.

import type { CallOutcome, CrmKind, Lead } from '../types.ts';

export interface CrmCredentials {
  kind: CrmKind;
  accessToken: string; // OAuth token or API key (stored encrypted server-side)
  accountId?: string; // e.g. GoHighLevel locationId
  systemName?: string; // Follow Up Boss X-System
  systemKey?: string; // Follow Up Boss X-System-Key
}

export type CrmLeadInput = Omit<
  Lead,
  'id' | 'orgId' | 'pinned' | 'timeline' | 'aiSummary' | 'aiWhyNow' | 'aiOpener' | 'touches'
> & { touches?: number };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** A normalized change event parsed from a CRM webhook. */
export interface CrmEvent {
  crm: CrmKind;
  kind: 'lead_created' | 'lead_updated' | 'lead_deleted' | 'note' | 'call' | 'text' | 'email' | 'task' | 'activity' | 'other';
  crmLeadIds: string[];
  raw: unknown;
}

/** A note already in the CRM (agents' past notes on the lead). */
export interface CrmNote {
  id: string;
  at: string;
  body: string;
  author?: string;
  pinned?: boolean;
}

export interface CrmCapabilities {
  sendText: boolean; // false → app falls back to the phone's Messages and logs it
  sendEmail: boolean;
  logCall: boolean;
  webhooks: boolean;
  maxRequestsPerMinute: number; // the sync worker throttles to this
}

export interface CrmAdapter {
  kind: CrmKind;
  capabilities: CrmCapabilities;

  /** One page of leads. `assignedTo` (a CRM user id) limits it to that person's leads. */
  listLeads(creds: CrmCredentials, cursor: string | null, opts?: { updatedSince?: string; assignedTo?: string }): Promise<Page<CrmLeadInput>>;
  getLead(creds: CrmCredentials, crmLeadId: string): Promise<CrmLeadInput | null>;

  /** The lead's existing notes, newest first (system notes skipped). */
  listNotes(creds: CrmCredentials, crmLeadId: string): Promise<CrmNote[]>;
  addNote(creds: CrmCredentials, crmLeadId: string, body: string): Promise<void>;
  logCall(creds: CrmCredentials, crmLeadId: string, call: { outcome: CallOutcome; note?: string; durationSec?: number; phone?: string }): Promise<void>;
  /** potentialCommission is written to a "Potential Commission" custom field the team creates once. */
  updateLead(creds: CrmCredentials, crmLeadId: string, patch: { stage?: string; tags?: string[]; potentialCommission?: number | null; assignedUserId?: string }): Promise<void>;
  createTask(creds: CrmCredentials, crmLeadId: string, task: { title: string; dueAt: string }): Promise<void>;
  sendText(creds: CrmCredentials, crmLeadId: string, body: string): Promise<void>;
  sendEmail(creds: CrmCredentials, crmLeadId: string, email: { subject: string; body: string }): Promise<void>;

  /** Parse an incoming webhook body into normalized events. */
  parseWebhook(body: unknown): CrmEvent[];
}

export class CrmError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/** Shared fetch wrapper: maps HTTP failures into retryable / permanent errors. */
export async function crmFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (res.ok) {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const retryable = res.status === 429 || res.status >= 500;
  throw new CrmError(`${init.method ?? 'GET'} ${url} → ${res.status}`, res.status, retryable);
}

export const OUTCOME_TEXT: Record<CallOutcome, string> = {
  talked: 'Talked',
  voicemail: 'Left voicemail',
  no_answer: 'No answer',
  attempted: 'Call attempted',
};
