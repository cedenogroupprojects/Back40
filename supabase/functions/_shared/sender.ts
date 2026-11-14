// Texts and emails sent through a CRM go out from whoever owns the API key
// (Lofty: that user's number). So a message may only use a key that belongs to
// the person sending it: the team key for whoever connected it, or the agent's
// own key. Anyone else gets null, and nothing is sent.
import type { CrmCredentials } from './core/index.ts';
import { credentialsFor, type Connection, type serviceClient } from './db.ts';

type Db = ReturnType<typeof serviceClient>;

export async function senderCredentials(db: Db, conn: Connection, senderId: string | null | undefined): Promise<CrmCredentials | null> {
  if (!senderId) return null;
  if (conn.owner_user_id && senderId === conn.owner_user_id) return credentialsFor(db, conn);
  const { data: k } = await db.from('member_send_keys').select('secret_ref').eq('org_id', conn.org_id).eq('user_id', senderId).eq('kind', conn.kind).maybeSingle();
  if (!k) return null;
  return credentialsFor(db, { ...conn, secret_ref: k.secret_ref as string });
}

export async function canSend(db: Db, conn: Connection, senderId: string): Promise<boolean> {
  if (conn.owner_user_id && senderId === conn.owner_user_id) return true;
  const { count } = await db.from('member_send_keys').select('user_id', { count: 'exact', head: true }).eq('org_id', conn.org_id).eq('user_id', senderId).eq('kind', conn.kind);
  return (count ?? 0) > 0;
}
