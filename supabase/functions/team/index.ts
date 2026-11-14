// POST /team { action, ... }
//   roster  (leader)  → everyone on the team's CRM, with Joined / Invited / not yet
//   invite  (leader)  { crmUserId, origin } → a one-time join link + a ready-to-send message
//   remove  (leader)  { userId } → takes an agent off the team; their leads go back to unassigned
//   info    (public)  { token } → what the join screen shows before sign-up
//   join    (signed in) { token } → an existing login joins the team
import { json, preflight, serviceClient, userClient, type Connection } from '../_shared/db.ts';
import { crmRoster, findInvite, joinTeam } from '../_shared/team.ts';

type Body = { action?: string; crmUserId?: string; origin?: string; userId?: string; token?: string };

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = (await req.json().catch(() => ({}))) as Body;
  const db = serviceClient();

  if (body.action === 'info') {
    const inv = await findInvite(db, body.token ?? '');
    if (!inv) return json({ error: "This invite link isn't valid. Ask your team leader for a new one." }, 404);
    const [{ data: org }, { data: leader }, { count }] = await Promise.all([
      db.from('organizations').select('name').eq('id', inv.org_id).maybeSingle(),
      db.from('members').select('display_name').eq('org_id', inv.org_id).eq('user_id', inv.created_by).maybeSingle(),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', inv.org_id).eq('crm_assignee_id', inv.crm_user_id),
    ]);
    return json({ team: org?.name ?? 'your team', leader: leader?.display_name ?? 'Your team leader', name: inv.name, email: inv.email, leads: count ?? 0, used: !!inv.used_at });
  }

  const { data: me } = await userClient(req).rpc('uid');
  if (!me) return json({ error: 'Sign in first.' }, 401);

  // An agent who already had a Back 40 login signs in, then joins with the link.
  if (body.action === 'join') {
    const inv = await findInvite(db, body.token ?? '');
    if (!inv) return json({ error: "This invite link isn't valid. Ask your team leader for a new one." }, 404);
    const { data: u } = await db.auth.admin.getUserById(me);
    const name = String(u?.user?.user_metadata?.name ?? '') || inv.name || 'Agent';
    const r = await joinTeam(db, inv, me, name);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
  }

  // Everything else is for the team leader.
  const { data: member } = await db.from('members').select('org_id, role').eq('user_id', me).limit(1).maybeSingle();
  if (!member) return json({ error: 'Set up your team first.' }, 400);
  if (member.role === 'agent') return json({ error: 'Only your team leader can do that.' }, 403);
  const org = member.org_id as string;

  if (body.action === 'roster') {
    const { data: conn } = await db.from('crm_connections').select('*').eq('org_id', org).eq('status', 'active').order('created_at').limit(1).maybeSingle();
    if (!conn) return json({ connected: false, people: [] });
    let crm;
    try {
      crm = await crmRoster(db, conn as Connection);
    } catch (e) {
      console.error('roster failed', (conn as Connection).kind, String(e).slice(0, 200));
      return json({ error: "Couldn't load your team from the CRM. Try again in a minute." }, 502);
    }
    const [{ data: members }, { data: invites }, { data: counts }] = await Promise.all([
      db.from('members').select('user_id, crm_user_id, display_name, role').eq('org_id', org),
      db.from('team_invites').select('crm_user_id, used_at, created_at').eq('org_id', org),
      db.rpc('lead_counts_by_assignee', { p_org: org }),
    ]);
    const leadsFor = new Map(((counts ?? []) as { crm_assignee_id: string; n: number }[]).map((r) => [r.crm_assignee_id, Number(r.n)]));
    const leaderCrm = new Set((members ?? []).filter((m) => m.role !== 'agent').map((m) => m.crm_user_id).filter(Boolean));
    const people = crm
      .filter((u) => !leaderCrm.has(u.crmUserId))
      .map((u) => {
        const joined = (members ?? []).find((m) => m.crm_user_id === u.crmUserId);
        const inv = (invites ?? []).find((i) => i.crm_user_id === u.crmUserId);
        return {
          crmUserId: u.crmUserId,
          name: joined?.display_name ?? u.name,
          email: u.email,
          status: joined ? 'joined' : inv ? 'invited' : 'none',
          userId: joined?.user_id ?? null,
          leads: leadsFor.get(u.crmUserId) ?? 0,
        };
      })
      .sort((a, b) => ({ joined: 0, invited: 1, none: 2 })[a.status]! - ({ joined: 0, invited: 1, none: 2 })[b.status]! || b.leads - a.leads || a.name.localeCompare(b.name));
    return json({ connected: true, crm: (conn as Connection).kind, people });
  }

  if (body.action === 'invite') {
    const crmUserId = String(body.crmUserId ?? '').trim();
    if (!crmUserId) return json({ error: 'Pick an agent.' }, 400);
    const origin = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(body.origin ?? '') ? body.origin! : 'https://back40-mobile.vercel.app';
    const { data: existing } = await db.from('team_invites').select('token, name, used_at').eq('org_id', org).eq('crm_user_id', crmUserId).maybeSingle();
    let token = existing?.token as string | undefined;
    let name = existing?.name as string | null | undefined;
    if (!token || existing?.used_at) {
      const { data: conn } = await db.from('crm_connections').select('*').eq('org_id', org).eq('status', 'active').order('created_at').limit(1).maybeSingle();
      const person = conn ? (await crmRoster(db, conn as Connection).catch(() => [])).find((u) => u.crmUserId === crmUserId) : undefined;
      if (!person) return json({ error: "That agent isn't on your CRM account." }, 400);
      token = newToken();
      name = person.name;
      const { error } = await db.from('team_invites').upsert(
        { org_id: org, crm_user_id: crmUserId, token, name: person.name, email: person.email, created_by: me, created_at: new Date().toISOString(), used_by: null, used_at: null },
        { onConflict: 'org_id,crm_user_id' },
      );
      if (error) return json({ error: 'Could not make the invite. Try again.' }, 500);
    }
    const link = `${origin}/join?t=${token}`;
    const first = (name ?? '').split(' ')[0] || 'Hey';
    return json({ link, message: `${first}, here's your Back 40 link. It brings your leads over from the CRM. Tap to join the team: ${link}` });
  }

  if (body.action === 'remove') {
    const userId = String(body.userId ?? '');
    const { data: m } = await db.from('members').select('role, crm_user_id').eq('org_id', org).eq('user_id', userId).maybeSingle();
    if (!m || m.role !== 'agent') return json({ error: 'Only agents can be removed here.' }, 400);
    await db.from('leads').update({ assigned_user_id: null }).eq('org_id', org).eq('assigned_user_id', userId);
    await db.from('members').delete().eq('org_id', org).eq('user_id', userId);
    if (m.crm_user_id) await db.from('team_invites').delete().eq('org_id', org).eq('crm_user_id', m.crm_user_id);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
