// Shared helpers for Edge Functions (Deno).
// `_shared/core` is a copy of packages/core/src made by `npm run core:sync`
// so functions deploy as self-contained bundles.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { CrmCredentials, CrmKind } from './core/index.ts';

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export type Connection = {
  id: string;
  org_id: string;
  kind: CrmKind;
  account_id: string | null;
  secret_ref: string | null;
  webhook_secret: string;
  status: string;
  owner_user_id: string | null;
  last_synced_at?: string | null;
  owner_crm_user_id?: string | null;
};

/** Read the CRM token for a connection from Supabase Vault (never stored in plain tables). */
export async function credentialsFor(db: ReturnType<typeof serviceClient>, conn: Connection): Promise<CrmCredentials> {
  const { data, error } = await db.rpc('read_crm_secret', { ref: conn.secret_ref });
  if (error || !data) throw new Error(`No credentials for connection ${conn.id}`);
  return {
    kind: conn.kind,
    accessToken: data as string,
    accountId: conn.account_id ?? undefined,
    systemName: Deno.env.get('FUB_SYSTEM_NAME') ?? undefined,
    systemKey: Deno.env.get('FUB_SYSTEM_KEY') ?? undefined,
  };
}

// The web app calls functions from the browser, so every response allows CORS.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

/** Answer the browser's CORS preflight. Returns null for normal requests. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;
}

/** A Supabase client acting as the signed-in user, so row-level security applies. */
export function userClient(req: Request) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

/** Exponential backoff with jitter for retries: 30s, 1m, 2m, 4m … capped at 1h. */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}
