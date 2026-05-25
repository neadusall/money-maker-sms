# recruit-sms

Recruiting-focused SMS outreach platform: upload candidate CSVs, launch campaigns through Telnyx, manage per-campaign inboxes, and use Claude to classify inbound replies and draft suggested responses on demand.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Drizzle ORM on Neon (serverless Postgres)
- Telnyx SDK v6 for SMS (outbound, inbound, delivery receipts, webhook signature verification)
- Anthropic Claude (`claude-opus-4-7`) for reply classification + on-demand draft generation
- Auth.js v5 with email magic links (Gmail SMTP)
- Vitest for unit tests

## Launch checklist

A short, ordered list to go from zero to "the app is running and your 10DLC number is sending real messages."

### 1. Fill in `.env`

```sh
cp .env.example .env
```

Then edit `.env`:

| Var | Where to get it |
|---|---|
| `DATABASE_URL` | Create a project at [neon.tech](https://neon.tech) → copy the connection string with `?sslmode=require` |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key |
| `TELNYX_API_KEY` | Telnyx Mission Control Portal → Account → API Keys → Create v2 key |
| `TELNYX_FROM_NUMBER` | Your 10DLC sender in E.164 (e.g. `+15555550123`) |
| `TELNYX_MESSAGING_PROFILE_ID` | Mission Control Portal → Messaging → Messaging Profiles → click yours → copy the ID from the URL |
| `TELNYX_PUBLIC_KEY` | Mission Control Portal → Account → API Keys → "Public Key" (ED25519) section |
| `TELNYX_MPS` | Mission Control Portal → Messaging → 10DLC → your campaign → "MPS" or "Throughput" |
| `AUTH_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SMTP_PASS` | [myaccount.google.com](https://myaccount.google.com) → Security → 2-Step Verification → App passwords → create one named "recruit-sms" |
| `ALLOWED_EMAILS` | Your email (default already set to `neadusall@gmail.com`) |
| `APP_TIMEZONE` | Your IANA TZ (e.g. `America/New_York`, `America/Chicago`, `America/Los_Angeles`) |

### 2. Push the schema

```sh
npm run db:push
```

This creates all 8 tables in Neon (campaigns, contacts, conversations, messages + Auth.js user/account/session/verificationToken).

### 3. Run the dev server

```sh
npm run dev
```

Open http://localhost:3000 — it'll redirect you to `/login`. Enter your email; you'll get a magic link in your inbox. Click it and you're in.

### 4. Expose the webhook to Telnyx (one-time tunnel setup)

Telnyx posts inbound SMS and delivery-receipt events to a public URL. Locally:

**Option A: Cloudflare Tunnel (recommended — free, stable URL once you authenticate)**

```sh
# install once: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://*.trycloudflare.com` URL it prints.

**Option B: ngrok (free, ephemeral URL)**

```sh
# install once: https://ngrok.com/download
ngrok http 3000
```

Copy the `https://*.ngrok-free.app` URL.

### 5. Configure the Telnyx webhook

In Telnyx Mission Control Portal → Messaging → Messaging Profiles → click your profile:

- **Inbound Settings → Webhook URL**: `<your-tunnel-url>/api/webhooks/telnyx`
- **Webhook API Version**: `2`
- **Webhook Failover URL**: leave empty (or duplicate the primary)
- Save.

Save the **public key** (in Account → API Keys, "Public Key" / ED25519) into `TELNYX_PUBLIC_KEY` in `.env`. This is how the app verifies that inbound webhooks really came from Telnyx.

### 6. Smoke test

1. Sign in to the app at http://localhost:3000.
2. **New campaign** → name it "Smoke test", template `Hi {first_name}, test message from recruit-sms.`, set send window to cover the current time.
3. **Contacts** → upload a one-row CSV with your own phone number:
   ```csv
   first_name,phone
   YourName,+15555550123
   ```
4. **Send batch** — you should receive the SMS within a few seconds.
5. Reply to the SMS — within a few seconds the conversation should show up in **Inbox** with a Claude classification (e.g. `positive`, `curious`).
6. Open the thread → **Generate draft with Claude** → review → **Send via Telnyx**.

If something fails: check the dev server console for `[telnyx-webhook]` / `[sendCampaignBatch]` / `[classify]` log lines.

## How it works

### Day-to-day workflow

1. **New campaign**: name, SMS template (with `{first_name}`-style merge tokens), role context (position summary, comp, location, selling points, approved language — fed to Claude as cached prompt context), and a daily send window (defaults 09:00–19:00 in your timezone).
2. **Contacts** → upload CSV. Recognized columns: first/last name, company, job title, phone (required), email, linkedin, location. Anything else becomes a custom merge field (`{your_column}`).
3. **Send batch** sends the next `BATCH_SIZE` pending contacts (default 10), paced to your registered 10DLC throughput (`TELNYX_MPS`), only if the current time is inside the send window. Click again to send the next batch.
4. **Inbox** shows replies. Each inbound is auto-classified into one of: positive, curious, negative, not_interested, wrong_person, stop, referral, asked_email/compensation/remote/client, already_employed, later, other.
5. In a thread, click **Generate draft with Claude** for a suggested reply. Edit it, then **Send via Telnyx**.

### LLM modes

| Mode | Behavior |
|------|----------|
| `draft_only` (default) | Classify on every inbound. Drafts are on-demand only — click "Generate draft" per message. |
| `semi_auto` | Same plus: auto-send drafts for clear positives (confidence ≥ 0.7 in positive/curious/asked_* categories), still respecting send window + MPS. |
| `manual` | Classify only. No drafts ever. |

### Always-on safety rails

These run regardless of LLM mode:

- **STOP keyword detection** — `stop`, `remove me`, `cancel`, `unsubscribe`, `end`, `quit` (anywhere in the first word) immediately marks the contact as opted-out, closes the conversation, and blocks all future outbound to that number.
- **Send window** — campaigns will not send outside their configured window (in `APP_TIMEZONE`). Pacing is enforced even during the window.
- **MPS pacing** — sends are throttled to `TELNYX_MPS`; this protects you from Telnyx rate-limit errors and 10DLC carrier filtering for over-sending.
- **Webhook signature verification** — inbound webhooks are rejected unless they verify against `TELNYX_PUBLIC_KEY`. Without verification, anyone with your tunnel URL could fake inbound messages.
- **Auth** — every app route except `/login`, `/verify-request`, `/api/auth/*`, and `/api/webhooks/*` is gated to emails in `ALLOWED_EMAILS`.

### Delivery receipts

The Telnyx webhook also receives `message.sent` and `message.finalized` events. The app updates each outbound message's `status` (queued → sending → sent → delivered, or `failed` with the error). Failed messages mark the contact as `failed` with the carrier error so you can see why in the Contacts page.

## Tests

```sh
npm test           # one-off
npm run test:watch # watch mode
```

Covers: merge-field rendering, STOP keyword detection, phone normalization, CSV column mapping, send-window logic.

## Going live (production)

When you're ready to move off localhost + tunnel:

1. Deploy to Vercel (or any Node host). Set all `.env` values as env vars there.
2. Update `AUTH_URL` to your production domain.
3. Update the Telnyx webhook URL to `https://your-domain/api/webhooks/telnyx`.
4. Confirm 10DLC brand + campaign are fully registered in Telnyx — unregistered traffic is filtered by carriers.
5. Re-test the smoke flow on the production URL.

## Project layout

```
src/
├── app/
│   ├── page.tsx                          # dashboard (campaigns)
│   ├── layout.tsx                        # nav + sign-out
│   ├── login/page.tsx                    # magic-link signin
│   ├── verify-request/page.tsx           # "check your email"
│   ├── campaigns/
│   │   ├── new/page.tsx
│   │   └── [id]/
│   │       ├── page.tsx                  # campaign overview + edit
│   │       ├── contacts/page.tsx         # CSV upload + contact list
│   │       └── inbox/
│   │           ├── page.tsx              # per-campaign inbox
│   │           └── [conversationId]/page.tsx  # thread + reply + draft button
│   └── api/
│       ├── auth/[...nextauth]/route.ts   # Auth.js handlers
│       └── webhooks/telnyx/route.ts      # inbound + delivery receipts
├── middleware.ts                         # auth-gates all non-public routes
├── components/CampaignForm.tsx
├── db/
│   ├── schema.ts                         # Drizzle tables (incl. auth tables)
│   └── client.ts                         # lazy Neon client
└── lib/
    ├── auth.ts                           # NextAuth config
    ├── actions.ts                        # server actions
    ├── telnyx.ts                         # send + webhook verify
    ├── anthropic.ts                      # Claude client
    ├── classify.ts                       # inbound classification (cached campaign context)
    ├── draft-reply.ts                    # on-demand draft generation
    ├── csv.ts                            # CSV parsing + column mapping
    ├── merge.ts                          # {token} template renderer
    ├── opt-out.ts                        # STOP keyword detection
    ├── phone.ts                          # E.164 normalization
    ├── pacing.ts                         # MPS rate-limit
    ├── send-window.ts                    # per-campaign TZ window check
    └── __tests__/*.test.ts               # Vitest unit tests
```

## Known limitations / still on the roadmap

- **No multi-tenant data isolation.** All allowlisted users see all campaigns. Add a `userId` foreign key on campaigns if you bring in teammates with separate books.
- **No retry/backoff** on transient Telnyx 5xx or Anthropic rate-limit errors. Failed sends mark contacts `failed`; you can retry manually via the "retry" link on the contacts page.
- **No campaign analytics** beyond per-status counts. Open rate isn't a thing in SMS, but reply rate / classification breakdown over time would be a useful next add.
- **Pacing is in-process** — works for single-process local/single-VM, will need a real queue (BullMQ / Redis) before horizontal scaling.
- **TCPA timezone gating uses your TZ, not the contact's.** Add per-contact TZ inference (from area code) if you're calling across coasts and want true TCPA safety.
