# Architecture: built for 20,000+ agents

## The shape

```
Phone (Expo) ──JWT──▶ Supabase Postgres (RLS) ◀── sync-worker ──▶ CRM APIs
     ▲                        │      ▲                              │
     └── Realtime (leads) ────┘      └──── sync_inbox ◀── crm-webhook ◀┘
```

- **The CRM is the source of truth.** Postgres keeps a fast copy of each agent's hot leads so the app opens instantly and works on a bad signal.
- **Writes never block the agent.**
  - "Save to CRM" puts a job in `sync_outbox` and returns.
  - Workers deliver each job to the CRM with retries: wait 30s, double each time, stop at 1h.
  - Each job carries an idempotency key from the phone, so a retried tap never writes twice.
- **Webhooks are cheap.** `crm-webhook` only checks the secret and stores the event. The worker re-fetches the lead from the CRM, so a forged or out-of-order event can't corrupt data.
- **Rate limits are per CRM connection.**
  - Each connection has a token bucket, so one big team can't use up the API budget for everyone else.
  - Reaching a limit pauses that connection only.
- **Horizontal workers.** `claim_inbox` and `claim_outbox` use `FOR UPDATE SKIP LOCKED`. When the queues back up, run more workers.

## Who sees what (row-level security)

`organizations → members (owner | admin | agent)`.

- Agents see the leads assigned to them.
- Owners and admins see the whole org.
- Teams never see each other's data.
- The sync tables and AI usage are server-only.

`supabase/tests/rls-check.mjs` proves all of this against real Postgres.

## Ranking (packages/core/src/ranking.ts)

Ranking is deterministic and explainable, and it runs the same way on the phone and the server.

- Brand-new leads that no one has contacted always go to the top.
- Everyone else is ordered by heat (0–100), which comes from:
  - stage
  - recent activity: viewing homes, replying, pre-approval
  - promised follow-ups
  - "going cold" after 2 days without contact
- The list is capped at about 10. Pinned leads always stay on.
- AI may adjust heat a little and writes the one-line "why now", but the order never depends on AI being up.

## AI (supabase/functions/ai)

- **Tasks:** `why_now`, `summary`, `extract` (call notes into fields), `draft` (text or email), and `ask`.
- **Models:** the fast model handles bulk work; the smart model handles drafts and Ask.
- **Guardrails:**
  - Facts come only from CRM data.
  - Fair-housing-safe language.
  - Nothing is sent without a tap.
- **Cost control:** a per-user daily cap, tracked in `ai_usage`. The cost per agent is roughly cents per day at normal use.

## Scaling notes

| Users | What changes |
|---|---|
| 0–2k | One Supabase Pro project, 1–2 workers on cron. |
| 2k–10k | Larger compute add-on, 4–8 workers, a read replica for Team dashboards. |
| 10k–20k+ | Split workers by CRM; move the AI queue to its own worker pool; partition `timeline_items` and `sync_*` by month. |

Indexes for the hot paths (`leads(org_id, assigned_user_id, heat)` and the queue status columns) are in the migration.
