# Can the CRM APIs do what Back 40 does?

Checked November 8, 2026 against developer.lofty.com and docs.followupboss.com.
Still to do: test each call against a real account before launch.

## Feature by feature

| Back 40 feature | Lofty | Follow Up Boss |
|---|---|---|
| Read leads, stage, tags, assigned agent | ✅ `GET /v1.0/leads` | ✅ `GET /v1/people` |
| Website activity: viewed homes, favorites, searches (feeds "hot right now") | ✅ `GET /v1.0/leads/{id}/activities` + webhook 3 | ✅ `GET /v1/events` + `eventsCreated` webhook |
| Tap to call | Phone dialer. No API needed. | Same |
| Log the call with its outcome | ✅ `POST /v1.0/logType` with `logType: logCall` and `callingOutcome` (Talked, VoiceMessage, NoAnswer). No duration field. | ✅ `POST /v1/calls` |
| Add notes | ✅ `POST /v1.0/notes` | ✅ `POST /v1/notes` |
| Follow-up reminder → task in the CRM | ✅ Tasks v2 | ✅ `POST /v1/tasks` |
| Edit stage / Pipeline board drag | ✅ `PUT /v1.0/leads/{id}` with `stage` (under 20 characters) | ✅ `PUT /v1/people/{id}` with `stage` |
| Tags | ✅ `tags`, `tagsAdd`, `tagsRemove` | ✅ |
| Potential commission saved in the CRM | ✅ Lead custom field via `customAttributeList`. The API can create the field. | ✅ Custom field `customPotentialCommission`. Only the account owner can create the field. |
| Send a text through the CRM | ✅ `POST /v1.0/message/sms/send`. **Sends from the caller's Lofty number, so the agent needs an active Lofty number.** | ❌ The API can only *log* a text. Back 40 opens the phone's Messages app, then logs the text to FUB. |
| Send an email through the CRM | ✅ `POST /v1.0/message/email/send`, from the caller's email setup | ❌ Log only. Back 40 opens the phone's Mail app, then logs it. |
| Real-time updates (new lead in under a minute) | ✅ Webhooks for 12 event types: leads, activity, calls, texts, notes, tasks, pipeline changes. Delivered in about a minute. | ✅ Webhooks for people, stage, notes, calls, texts, tasks and deals. **Only the account owner can set them up.** Limit of 2 per event per system. |
| Team admin: agents list, who has which leads | ✅ Team Members endpoint + `assignedUserId` | ✅ `GET /v1/users` + `assignedUserId` |
| Reassign a stale lead | ✅ `PUT /v1.0/leads/{id}` `assignedUserId`, or Assign Lead | ✅ `PUT /v1/people/{id}` `assignedUserId` |
| Escrow (optional, deeper) | ✅ Transactions + transaction pipelines | ✅ Deals + pipelines |

**Bottom line:**
- Every feature works on Lofty.
- On Follow Up Boss, everything works except sending texts and emails through the CRM. Those go through the phone and get logged. The app already does this.

## What the API key permissions mean

**Lofty**
- An **API key is personal**. It acts as the person who made it and sees only what they can see.
- For a product sold to many teams, use **OAuth**. Register Back 40 as an app in Lofty's Developer Portal.
- Webhooks are subscribed for the whole team. With the default setting, the assigned agent plus company owners and admins get each event.

**Follow Up Boss**
- An API key has the same access as that user's login. An agent's key sees only that agent's contacts.
- Back 40 also has to register as a "system" with FUB and send `X-System` and `X-System-Key` on every request. Registered systems get about 250 requests per 10 seconds; unregistered ones get about 125.
- Some endpoints, like logging texts, only work for registered systems.

**So we connect two ways:**
1. **The team owner or admin connects once.** That connection syncs every lead, receives webhooks, and powers Team admin and reassigning.
2. **Each agent signs in with their own CRM account.** Their calls, notes and texts then show up as *them*, and texts go out from *their* Lofty number. If everything ran through the owner's connection, every text would come from the owner's number.

## Gotchas found

- **Lofty errors.** Lofty returns HTTP 200 with an error in the body unless you send `X-Error-Status: true`. The adapter now sends it on every request.
- **Lofty docs.** The old docs at api.lofty.com/docs were retired. Build against developer.lofty.com.
- **Lofty rate limits** aren't published. The adapter assumes 120 a minute per connection. Ask Lofty for the real number.
- **Lofty stage names** must be under 20 characters. All Back 40 board stages fit.
- **Follow Up Boss webhooks** only say *that* something changed. The worker fetches the record to see what. It already does this.
- **Follow Up Boss custom fields** come back only if you ask for `fields=allFields`.

## Changes made to the adapters from this check

- Lofty calls are now logged as real call logs with outcomes, through `/v1.0/logType`. Before, they were saved as notes.
- Lofty requests send `X-Error-Status: true`.
- Lofty and Follow Up Boss updates can now set potential commission and the assigned agent.
- Removed VERIFY on Lofty SMS. The endpoint is confirmed.
- Still marked VERIFY:
  - Lofty task body fields (v2)
  - The custom field `attributeType` value for a number field
