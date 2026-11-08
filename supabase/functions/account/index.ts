// POST /account { email, password, name, team? }
// Creates a ready-to-use login (no confirmation email needed), so a new agent
// can sign up from their phone in one step. The app then signs in with the
// password and calls create_team to set up their team.
import { json, preflight, serviceClient } from '../_shared/db.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const { email, password, name } = (await req.json().catch(() => ({}))) as { email?: string; password?: string; name?: string };
  const e = (email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json({ error: 'Enter a valid email.' }, 400);
  if (!password || password.length < 8) return json({ error: 'Use at least 8 characters for your password.' }, 400);
  const db = serviceClient();
  const { error } = await db.auth.admin.createUser({ email: e, password, email_confirm: true, user_metadata: { name: (name ?? '').trim() } });
  if (error) {
    const taken = /already|registered|exists/i.test(error.message);
    return json({ error: taken ? 'That email already has an account. Sign in instead.' : 'Could not create the account. Try again.' }, taken ? 409 : 400);
  }
  return json({ ok: true });
});
