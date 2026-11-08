# Back 40

The mobile hot sheet that sits on top of an agent's CRM. Today shows the people worth calling, the agent taps Call, and everything they do is written back to the CRM.

The CRMs are Lofty first, then Follow Up Boss, then GoHighLevel.

## What's in here

```
apps/mobile        Expo app (iOS, Android, web). Runs on sample data until Supabase is configured.
packages/core      Shared TypeScript: ranking, scoring, and the CRM adapters (Lofty, FUB, GHL).
supabase/          Postgres schema with row-level security, plus Edge Functions:
  migrations/        organizations, members, leads, sync queues, AI usage, ...
  functions/
    crm-webhook/     receives CRM events, verifies them, stores them, returns fast
    sync-worker/     drains sync_inbox (CRM → app) and sync_outbox (app → CRM)
    log-call/        the app's "Save to CRM", which queues writes with idempotency keys
    voice/           turns the morning briefing into human-sounding audio (ElevenLabs), cached
    ai/              why-now lines, summaries, call-note extraction, drafts, Ask
  tests/rls-check.mjs  proves agents only see their own leads (runs on pglite)
docs/ARCHITECTURE.md how it scales, and what to verify before launch
docs/CRM-API-CHECK.md what Lofty and Follow Up Boss can and can't do through their APIs
```

## Run it

```bash
npm test                       # core ranking/scoring tests
npm run rls-check              # database permission test (needs: npm i @electric-sql/pglite)
cd apps/mobile && npm install
npx expo start                 # scan with Expo Go, or press w for web
```

To switch from sample data to live data, fill in `expo.extra.supabaseUrl` and `supabaseAnonKey` in `apps/mobile/app.json`.

## Backend setup (Supabase)

1. Run `supabase db push` to apply the migration.
2. Store each CRM token in Vault. Put the Vault id in `crm_connections.secret_ref`.
3. Set the Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
   - `AI_MODEL_FAST`: default `claude-haiku-5-5`
   - `AI_MODEL_SMART`: default `claude-sonnet-5-5`
   - `AI_DAILY_CALLS_PER_USER`
   - `FUB_SYSTEM_NAME` and `FUB_SYSTEM_KEY`
   - `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`: the natural voice for the morning briefing. Optional: `ELEVENLABS_MODEL` (default `eleven_multilingual_v2`) and `VOICE_DAILY_PER_USER` (default 10).
4. Run `npm run core:sync`, then `supabase functions deploy`.
   - Edge Functions can't import across folders, so they use a copy of `packages/core`.
   - Rerun `npm run core:sync` whenever core changes.
5. Schedule `sync-worker` to run every minute with pg_cron. You can run more copies when there are more users; jobs are claimed with `SKIP LOCKED`, so workers never step on each other.
6. Register the webhook URL in each CRM: `.../functions/v1/crm-webhook?c=<connection_id>&s=<webhook_secret>`.

Auth works with either Supabase Auth or Clerk. The database reads the user from the JWT `sub` claim.

## Before launch

- Confirm the Lofty endpoints marked `VERIFY` in `packages/core/src/crm/lofty.ts` against the Lofty partner docs.
- Follow Up Boss's API can't send texts or email. The app falls back to the phone's Messages app and logs the message.
- Get a TCPA legal review before turning on any auto-send ("autopilot"). Autopilot is off by default.
- Don't add call recording. California requires every party's consent.
