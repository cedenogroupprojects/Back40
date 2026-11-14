// Team invites, shared by the `team` and `account` functions.
// A team leader invites agents straight from their CRM's user list; each invite is
// a one-time link tied to that agent's CRM user, so their leads are on their list
// the moment they join.
import { ghlUsers } from './core/index.ts';
import { credentialsFor, type Connection, type serviceClient } from './db.ts';

type Db = ReturnType<typeof serviceClient>;
export type CrmUser = { crmUserId: string; name: string; email: string | null };

/** Everyone on the team's CRM account (Lofty members, Follow Up Boss users, GoHighLevel users). */
export async function crmRoster(db: Db, conn: Connection): Promise<CrmUser[]> {
  const creds = await credentialsFor(db, conn);
  const clean = (e: unknown) => (typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : null);
  if (conn.kind === 'lofty') {
    const out: CrmUser[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const res = await fetch(`https://api.lofty.com/v1.0/members?offset=${offset}&limit=100`, {
        headers: { Authorization: `token ${creds.accessToken.replace(/^oauth:/, '')}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`lofty members ${res.status}`);
      const d = (await res.json()) as Record<string, unknown>;
      const page = ((d.members ?? (d.data as Record<string, unknown> | undefined)?.members ?? []) as Record<string, unknown>[]);
      for (const m of page) {
        const id = m.memberUserId ?? m.id;
        if (id == null) continue;
        const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || String(m.name ?? '') || 'Agent';
        out.push({ crmUserId: String(id), name, email: clean(m.email) });
      }
      if (page.length < 100) break;
    }
    return out;
  }
  if (conn.kind === 'followupboss') {
    const auth = `Basic ${btoa(`${creds.accessToken}:`)}`;
    const res = await fetch('https://api.followupboss.com/v1/users?limit=100', { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`fub users ${res.status}`);
    const d = (await res.json()) as { users?: { id: number; name?: string; email?: string }[] };
    return (d.users ?? []).map((u) => ({ crmUserId: String(u.id), name: u.name ?? 'Agent', email: clean(u.email) }));
  }
  const users = await ghlUsers(creds);
  return users.map((u) => ({ crmUserId: u.id, name: u.name ?? 'Agent', email: clean(u.email) }));
}

export type Invite = { id: string; org_id: string; token: string; crm_user_id: string; name: string | null; email: string | null; created_by: string; used_at: string | null };

export async function findInvite(db: Db, token: string): Promise<Invite | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data } = await db.from('team_invites').select('*').eq('token', token).maybeSingle();
  return (data as Invite | null) ?? null;
}

/**
 * Put a signed-up person on the team as an agent, linked to their CRM user:
 * their leads already in Back 40 move onto their list, and the rest import.
 */
export async function joinTeam(db: Db, inv: Invite, userId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (inv.used_at) return { ok: false, error: 'This invite was already used. Ask your team leader for a new one.' };

  const { data: current } = await db.from('members').select('org_id').eq('user_id', userId).limit(1).maybeSingle();
  if (current && current.org_id !== inv.org_id) {
    // An account that set up its own empty team (e.g. tried the app first) can switch over.
    const { count: others } = await db.from('members').select('user_id', { count: 'exact', head: true }).eq('org_id', current.org_id).neq('user_id', userId);
    const { count: conns } = await db.from('crm_connections').select('id', { count: 'exact', head: true }).eq('org_id', current.org_id);
    if ((others ?? 0) > 0 || (conns ?? 0) > 0) return { ok: false, error: "You're already on another team in Back 40. Sign out and use a different email for this invite." };
    await db.from('members').delete().eq('org_id', current.org_id).eq('user_id', userId);
    await db.from('organizations').delete().eq('id', current.org_id);
  }

  const { error } = await db.from('members').upsert(
    { org_id: inv.org_id, user_id: userId, role: 'agent', display_name: name || inv.name || 'Agent', crm_user_id: inv.crm_user_id },
    { onConflict: 'org_id,user_id' },
  );
  if (error) return { ok: false, error: `Could not join the team (${error.message}).` };
  await db.from('team_invites').update({ used_by: userId, used_at: new Date().toISOString() }).eq('id', inv.id);

  // Leads already synced for this CRM user move to them; then import the rest of theirs.
  await db.from('leads').update({ assigned_user_id: userId }).eq('org_id', inv.org_id).eq('crm_assignee_id', inv.crm_user_id);
  const { data: conns } = await db.from('crm_connections').select('id, kind').eq('org_id', inv.org_id).eq('status', 'active');
  for (const c of conns ?? []) {
    await db.from('sync_inbox').insert({ connection_id: c.id, crm: c.kind, kind: 'backfill', raw: { cursor: null, page: 1, assignee: inv.crm_user_id } });
  }
  return { ok: true };
}
