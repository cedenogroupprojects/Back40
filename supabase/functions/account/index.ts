// POST /account { email, password, name, token? }
// Creates a ready-to-use login (no confirmation email needed), so a new agent
// can sign up from their phone in one step. Without a token the app then calls
// create_team to set up their own team. With a team invite token the agent is
// put on that team here, before they ever sign in, linked to their CRM user.
import { json, preflight, serviceClient } from '../_shared/db.ts';
import { findInvite, joinTeam } from '../_shared/team.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const { email, password, name, token } = (await req.json().catch(() => ({}))) as { email?: string; password?: string; name?: string; token?: string };
  const e = (email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json({ error: 'Enter a valid email.' }, 400);
  if (!password || password.length < 8) return json({ error: 'Use at least 8 characters for your password.' }, 400);
  const db = serviceClient();

  const inv = token ? await findInvite(db, token) : null;
  if (token && !inv) return json({ error: "This invite link isn't valid. Ask your team leader for a new one." }, 404);
  if (inv?.used_at) return json({ error: 'This invite was already used. Sign in instead, or ask your team leader for a new one.' }, 409);

  const display = (name ?? '').trim();
  const { data, error } = await db.auth.admin.createUser({ email: e, password, email_confirm: true, user_metadata: { name: display } });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? '');
    return json({ error: taken ? 'That email already has an account. Sign in instead.' : 'Could not create the account. Try again.' }, taken ? 409 : 400);
  }
  if (inv) {
    const joined = await joinTeam(db, inv, data.user.id, display);
    if (!joined.ok) {
      await db.auth.admin.deleteUser(data.user.id);
      return json({ error: joined.error }, 400);
    }
  }
  return json({ ok: true, joined: !!inv });
});
