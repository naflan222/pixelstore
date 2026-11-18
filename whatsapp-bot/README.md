# PIXELHOUSE WhatsApp Bot (scaffold)

A WhatsApp Cloud API webhook receiver + auto-reply bot for PIXELHOUSE, a
Sri Lankan action-camera store in Tangalle. It answers common customer
questions instantly (prices, rental, delivery, location) and hands
everything else to a human with a polite holding reply.

Status: **deployed via Vercel from this repo.** The Meta app
(Pixelhouse Automation), the WhatsApp Business Account, the registered
phone number (0707466675) and the permanent System User token all exist.
Configuration comes from environment variables (see below); nothing here
calls Meta except through those variables.

## How it works

```
Customer message -> Meta Cloud API -> POST /api/webhook -> reply via Graph API
```

1. **Verification handshake (GET).** Meta sends `hub.mode=subscribe`,
   `hub.verify_token` and `hub.challenge`. The handler answers `200` with
   the challenge value only when the token matches
   `WHATSAPP_VERIFY_TOKEN`.
2. **Signature check (POST).** Every POST carries `X-Hub-Signature-256`
   (HMAC-SHA256 of the raw body, keyed with the app secret). The handler
   validates it with a constant-time compare before trusting the payload,
   and rejects bad signatures with `401`.
3. **Parsing.** Inbound text messages and delivery statuses are extracted
   from `entry[].changes[].value`. Statuses are only logged. Non-text
   messages (image, audio, ...) are logged and skipped.
4. **Dedupe.** Message ids (wamids) are deduped in memory: Meta retries
   deliveries for up to 7 days, so the same message can arrive twice.
   See "Known limits" — serverless memory is ephemeral.
5. **24-hour window gate.** Free-form replies are only allowed within 24
   hours of the customer's last message (computed from the inbound
   message timestamp). Older messages are logged and skipped — the bot
   never attempts a free-form send outside the window.
6. **Reply.** The rules engine (`lib/rules.js`) matches the text against
   FAQ intents and returns a reply, or the holding reply when nothing
   matches. The reply is sent with
   `POST /v26.0/{phone_number_id}/messages`.
7. **Logging.** Every inbound, outbound, skipped and failed event is
   logged as one JSON line, so Vercel logs stay searchable.

## Files

| File | What it does |
|---|---|
| `api/webhook.js` | Vercel serverless adapter: reads the raw body, calls the core handler. |
| `lib/webhook.js` | Core logic: handshake, signature check, parse, dedupe, window gate, reply. Transport-independent and unit-tested. |
| `lib/verify.js` | HMAC-SHA256 signature computation + constant-time validation. |
| `lib/parse.js` | Webhook payload parsing (messages + statuses). Never throws. |
| `lib/dedupe.js` | In-memory wamid dedupe store (bounded, FIFO eviction). |
| `lib/window.js` | 24-hour customer-service window check. |
| `lib/rules.js` | Pure FAQ rules engine: intents, approved prices, reply texts. |
| `lib/send.js` | Graph API `POST /messages` sender (fetch injectable for tests). |
| `lib/log.js` | Structured JSON logging. |
| `test/webhook.test.js` | Test suite (Node built-in runner, no network calls to Meta). |
| `vercel.json` | Minimal Vercel project config. |
| `.env.example` | Environment variable template (no values). |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | Yes | Secret string you invent; Meta sends it back during handshake. |
| `WHATSAPP_APP_SECRET` | Yes | App Secret from the Meta app dashboard (Settings > Basic). |
| `WHATSAPP_ACCESS_TOKEN` | Yes | Permanent System User token with `whatsapp_business_messaging` and `whatsapp_business_management`. Never use a temporary dashboard token (expires in <24h). |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Phone Number ID from WhatsApp > API Setup (the numeric ID, not the phone number). |
| `GRAPH_API_VERSION` | No | Defaults to `v26.0`. |
| `WHATSAPP_TEMPLATE_NAME` | No | Reserved for a follow-up: approved template for out-of-window replies. Currently only logged, never sent. |

No secrets live in code. On Vercel, set variables in
Project > Settings > Environment Variables.

## Deploy on Vercel

Prereqs: a Vercel account, the Vercel CLI (`npm i -g vercel`), and the
Meta-side values above.

```sh
cd pixelhouse_whatsapp_bot
vercel login
vercel link            # or: vercel --prod, then follow the prompts
vercel env add WHATSAPP_VERIFY_TOKEN production
vercel env add WHATSAPP_APP_SECRET production
vercel env add WHATSAPP_ACCESS_TOKEN production
vercel env add WHATSAPP_PHONE_NUMBER_ID production
vercel --prod
```

Note the production URL, e.g. `https://pixelhouse-whatsapp-bot.vercel.app`.
The webhook endpoint is:

```
https://<project>.vercel.app/api/webhook
```

Redeploy after changing code with `vercel --prod`. Environment variable
changes also need a redeploy to take effect.

## Register the callback URL in Meta

In the Meta app dashboard (the app with the WhatsApp product):

1. Open **WhatsApp > Configuration**.
2. Under **Webhook**, click **Edit**.
3. **Callback URL:** `https://<project>.vercel.app/api/webhook`
4. **Verify token:** the exact value of `WHATSAPP_VERIFY_TOKEN`.
5. Click **Verify and save**. Meta sends the GET handshake; the endpoint
   answers the challenge only when the token matches.
6. Click **Subscribe** / manage webhook fields and subscribe to the
   **`messages`** field (inbound messages + delivery statuses).

Then, in **WhatsApp > API Setup**, confirm the phone number is registered
and note the Phone Number ID used in `WHATSAPP_PHONE_NUMBER_ID`.

## Test

No Meta calls are made by the tests — the Graph API sender is exercised
with a mock `fetch`, and signatures are computed locally with `node:crypto`.

```sh
npm test     # node --test test/
npm run check  # node --check on every source and test file
```

The suite covers: the verification handshake (matching/mismatched token),
HMAC validation (valid signature, tampered body, wrong secret, malformed
header), payload parsing (messages, statuses, unsupported types, malformed
input), dedupe (repeat + eviction), every FAQ intent (all 10 product
prices, ambiguous selfie-stick/strap questions, generic price, rental,
delivery, location, greeting, unknown/complaint/stock -> holding reply),
the 24-hour window gate (recent, exactly 24h, expired, invalid), the send
function's request shape, and end-to-end handler behaviour (valid message
-> reply sent, duplicate -> skipped, bad signature -> 401, old message ->
skipped, statuses-only -> no send).

Manual check against a local dev server:

```sh
vercel dev   # serves http://localhost:3000/api/webhook
curl "http://localhost:3000/api/webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=12345"
# -> 200, body "12345" when the token matches; 403 otherwise
```

To test a POST locally, compute the signature over the exact raw body:

```sh
node -e "const c=require('node:crypto'),fs=require('node:fs');const b=fs.readFileSync('payload.json');console.log('sha256='+c.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(b).digest('hex'))"
curl -X POST http://localhost:3000/api/webhook -H "Content-Type: application/json" -H "X-Hub-Signature-256: <SIG>" --data-binary @payload.json
```

## What the bot answers

Only the approved facts in `lib/rules.js`:

- **Greeting** — welcome + what the shop sells.
- **Prices** — the 10 listed accessories, each with its exact LKR price.
  A named product gets its price; "selfie stick" or "strap/mount" without
  a type gets the options list; a bare price question asks which product.
- **Location** — Tangalle, Sri Lanka. Opening hours are never invented;
  the reply says to message for hours.
- **Rental** — camera rental is available; asks what gear is needed.
- **Delivery** — delivery is available; cost and timing are confirmed by
  a team member (never invented).
- **Anything else** (orders, complaints, stock checks, unknown) — the
  holding reply: a team member will reply soon, urgent help on
  0777 466 675.

The bot never promises stock, delivery dates, discounts, or prices that
are not listed. Edit `lib/rules.js` to change answers — keep the content
rules in its header.

## What remains (follow-ups, not in this scaffold)

1. **Meta setup values** — Meta developer app + WhatsApp Business
   Account, a registered phone number (a second number: the shop's
   0777 466 675 stays in the WhatsApp Business app), and a permanent
   System User token. Then set the env vars and deploy.
2. **Approved message template** for replies outside the 24-hour window
   (currently logged + skipped). Needs a template created and approved in
   Meta, plus a template-send path in `lib/send.js`.
3. **Persistent store** — dedupe and any conversation state must move out
   of serverless memory (Vercel KV, Postgres, ...) before production, or
   duplicate replies and lost state will occur across instances.
4. **Async processing** — the handler currently awaits the send before
   answering 200. At volume, acknowledge 200 immediately and process
   from a queue (Meta retries unacknowledged deliveries for 7 days).
5. **Media handling** — image/audio/location messages are currently
   skipped. Decide whether they should get the holding reply instead.
6. **Monitoring** — alerting on `webhook.send_failed` / signature
   rejections, and a periodic check that the webhook subscription is
   still active.

## Security notes

- The app secret and access token are only ever read from environment
  variables, never stored in code, logs, or the repo.
- Signatures are validated over the raw body with a constant-time
  compare; unsigned or mis-signed requests are rejected before any
  parsing or sending.
- The send function only ever POSTs to `graph.facebook.com`.
- Review `lib/rules.js` before going live: every word the bot sends
  comes from there.
