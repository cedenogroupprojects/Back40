import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema vault;
create table auth.claims(v jsonb); insert into auth.claims values ('{}');
create function auth.jwt() returns jsonb language sql stable as $$ select v from auth.claims $$;
create table vault.decrypted_secrets(id uuid primary key, decrypted_secret text);
create publication supabase_realtime;
`);
// Load every migration given on the command line, in order.
for (const f of process.argv.slice(2)) await db.exec(fs.readFileSync(f, 'utf8'));
// RLS smoke test: two orgs, an agent must only see their own org + own leads.
await db.exec(`
insert into organizations(id,name) values ('00000000-0000-0000-0000-00000000000a','Team A'),('00000000-0000-0000-0000-00000000000b','Team B');
insert into members(org_id,user_id,role,display_name) values
 ('00000000-0000-0000-0000-00000000000a','lead_a','owner','Leader A'),
 ('00000000-0000-0000-0000-00000000000a','agent_a','agent','Agent A'),
 ('00000000-0000-0000-0000-00000000000b','agent_b','agent','Agent B');
insert into crm_connections(id,org_id,kind) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','lofty'),('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000b','lofty');
insert into leads(org_id,connection_id,crm,crm_lead_id,assigned_user_id,stage,crm_created_at,first_name) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','lofty','1','agent_a','Active Buyer',now(),'A-mine'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','lofty','2','someone_else','Active Buyer',now(),'A-other'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c2','lofty','3','agent_b','Active Buyer',now(),'B-lead');
insert into sync_outbox(org_id,connection_id,op,payload,idempotency_key) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','add_note','{}','k1');
update leads set label = 'hot_now', fields = '{"potentialCommission": 18000}' where crm_lead_id in ('1','2');
grant usage on schema public, auth to authenticated; grant select, update, insert on all tables in schema public to authenticated; grant select on auth.claims to authenticated;
`);
async function as(user) {
  await db.exec(`update auth.claims set v = '{"sub":"${user}"}'`);
  await db.exec('set role authenticated');
  const r = await db.query('select first_name from leads order by first_name');
  const o = await db.query('select count(*)::int n from sync_outbox');
  await db.exec('reset role');
  return [r.rows.map(x=>x.first_name), o.rows[0].n];
}
console.log('agent_a sees', await as('agent_a'));
console.log('lead_a (owner) sees', await as('lead_a'));
console.log('agent_b sees', await as('agent_b'));
console.log('stranger sees', await as('nobody'));
const dup = await db.query(`insert into sync_outbox(org_id,connection_id,op,payload,idempotency_key) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','add_note','{}','k1') on conflict (idempotency_key) do nothing returning id`);
console.log('duplicate write blocked:', dup.rows.length === 0);
const claimed = await db.query('select id from claim_outbox(10)');
console.log('worker claimed', claimed.rows.length, 'job(s)');

async function pipelineAs(user) {
  await db.exec(`update auth.claims set v = '{"sub":"${user}"}'`);
  await db.exec('set role authenticated');
  const r = await db.query('select assigned_user_id, leads, stale_hot, potential_commission::int as money from team_pipeline order by assigned_user_id');
  await db.exec('reset role');
  return r.rows.map((x) => `${x.assigned_user_id}: ${x.leads} lead(s), ${x.stale_hot} stale, $${x.money}`);
}
console.log('team admin view, owner:', await pipelineAs('lead_a'));
console.log('team admin view, agent:', await pipelineAs('agent_a'));
