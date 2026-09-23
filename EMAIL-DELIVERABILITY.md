# Why your emails land in spam — and how to fix it

## 0. Password-reset OTP audit (2026-09-14) — what is code-side vs Brevo-side

The reported Gmail headers (From/Reply-To `support@lankalens.online`, SPF **PASS**,
DKIM **PASS** `d=lankalens.online s=brevo2`, DMARC **PASS**, Return-Path
`bounces-…@send.lankalens.online`, SMTP IP `77.32.148.27`) were audited against the
code in `server/mailer.js` and against Brevo's documented behaviour.

| Header / feature | Who adds it | Can our code remove it? |
|---|---|---|
| `List-Unsubscribe`, `List-Unsubscribe-Post` | **Brevo**, injected into every relayed message — campaigns *and* transactional API/SMTP sends | **No.** No API/SMTP parameter suppresses it. Only Brevo Support can swap it for a `List-Help` header (Enterprise plan, recipient-triggered transactional mail — see §3) |
| Open-tracking pixel `r.send.lankalens.online/tr/op/…` | **Brevo** (custom tracking domain on your verified domain) | **Not removed**, but it can be told *not to track* per recipient via the API (`contactPixelTrackingConsent`) — see §3 |
| `Feedback-ID`, `X-CSA-Complaints` | **Brevo** (Certified Senders Alliance / bulk-sender headers) | **No** |
| `Message-ID` `@smtp-relay.mailin.fr` | **Brevo's MTA** (relays rewrite Message-ID) | **No** — and it should not be faked |
| `From`, `Reply-To`, subject, text+HTML body | **Our code** (`server/mailer.js`) | Yes — verified correct, unchanged |
| SPF / DKIM / DMARC records | DNS | **Left untouched** — all three pass; nothing to fix (§2) |

**Verified in code**

- Password resets go to the **transactional** endpoint only:
  `POST https://api.brevo.com/v3/smtp/email` (Brevo HTTP API) or the Brevo SMTP
  relay (`smtp-relay.brevo.com`). Nothing in the project calls
  `/v3/emailCampaigns`, imports contacts, or uses a list/marketing template —
  `grep -ri unsubscribe server/ js/ api/` returns nothing. The recipients never
  need to be Brevo contacts.
- The OTP message is already minimal and transactional: `PixelHouse`, the 6-digit
  code, "expires in 15 minutes and can only be used once", "if you didn't request
  this, you can safely ignore this email". **No links, no images, no marketing
  language, no promotional content.** Both `textContent` and `htmlContent` are
  sent (multipart/alternative).
- `From: PixelHouse <support@lankalens.online>` and
  `Reply-To: support@lankalens.online` are unchanged.
- **Nothing in the code enables campaign-style tracking or unsubscribe features**,
  so items 1–3 in the table above arrive from Brevo, not from this application.

**Sending IP check:** `77.32.148.27` reverse-resolves to `ha.d.sender-sib.com` —
Brevo/Sendinblue sending infrastructure, consistent with the reported provider.
No rogue relay is involved.

**Verdict:** this is a **Brevo-side** situation, not a code bug. Your DNS is
correct and must not be changed to chase it.

---

## 1. Brevo: authenticate `lankalens.online` (done — leave it alone)

This deployment is already authenticated in Brevo. Confirmed by public DNS on
2026-09-14 (read-only lookups):

| Record | Actual live value |
|---|---|
| SPF (`@`) | `v=spf1 include:spf.privateemail.com include:spf.brevo.com ~all` |
| SPF (`send`) | `v=spf1 include:spf.brevo.com -all` — the bounce/Return-Path subdomain |
| DKIM | `brevo2._domainkey` (2048-bit RSA) — the selector signing your mail |
| DMARC (`_dmarc`) | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
| MX | `mx1`/`mx2.privateemail.com` — so `support@lankalens.online` is a live mailbox |

⚠️ **Do not replace these with generic values copied from a blog or older guide.**
Some guides (and earlier versions of this file) list `include:_spf.sendinblue.com`
and `mail._domainkey` / `mail2._domainkey`. Your Brevo account issued
`spf.brevo.com` and `brevo2._domainkey`, and **those are the records Gmail is
currently validating successfully**. Only change a record if Brevo's own
*Senders, Domains & Dedicated IPs → Domains* page shows it as unverified — and
even then, SPF/DKIM/DMARC are not what is putting you in spam.
(If Brevo's dashboard shows a second, unverified DKIM record, that is redundancy,
not a failure: DKIM already passes with `brevo2`.)

Useful to know:

- **DKIM is signed as `lankalens.online`** (not as Brevo's own domain), which is
  the strong, aligned setup. This was the single biggest historical fix and it is done.
- `DMARC p=none` is "monitor only". It passes and it is not the spam cause. Moving
  to `p=quarantine` later is a *reputation* nicety, not a fix — and only do it once
  the `rua=` reports show everything passing. **Not recommended right now.**

## 2. What is *not* in control of the application

- **List-Unsubscribe / List-Unsubscribe-Post** — Brevo's own documentation states a
  list-unsubscribe header is *mandatory and added by default* to email campaigns
  **and** transactional emails. Brevo's rationale is that its API/SMTP interfaces
  carry both kinds of mail, so it cannot distinguish them per message. This is why a
  password-reset email arrives looking like a mailing-list message. Removing it is
  **not possible from code** — trying to strip or override it would mean tampering
  with the message after Brevo, which is exactly the kind of "faking headers"
  behaviour to avoid.
- **Open/click tracking** — Brevo inserts the pixel (`…/tr/op/…`) and rewrites links
  on relayed mail. There is no per-message switch in the v3 API or the SMTP relay;
  Brevo's own transactional settings only offer **anonymous** tracking.

## 3. Exact Brevo settings to change (dashboard side)

Do these in **Brevo → app.brevo.com**, not in this repo:

1. **List-Unsubscribe → List-Help (the real fix for "why does my OTP have
   unsubscribe headers").**
   Brevo documents a `List-Help` header as the correct alternative *for
   transactional emails only* — explicitly naming password-reset emails — with the
   condition that the mail must be recipient-triggered and contain no promotional
   content (your OTP qualifies). It is **only available on the Enterprise plan, and
   only through Brevo Support**: open a ticket from
   *Account → Support*
   ([account-app.brevo.com/account/zendesk-support](https://account-app.brevo.com/account/zendesk-support)) and ask them to
   *"replace the List-Unsubscribe header with a List-Help header for transactional
   emails sent from `support@lankalens.online` (password resets / order
   confirmations), which are recipient-triggered and contain no promotional
   content"*. Nothing in this repo can do that for you — do not accept a code
   workaround.
2. **Stop per-recipient open/click tracking** — *only needed for the SMTP transport,
   or if you prefer an account-wide switch*: ask the same ticket to *"disable open
   and click tracking for transactional emails on this account"*. Brevo support can
   do this after a compliance review; the setting is not exposed to customers.
   For the **HTTP API transport** you can do it yourself — see §4.
3. **Anonymous tracking** (optional, weak): *Settings → Automations → Transactional
   emails → Tracking → **Anonymous email tracking = Yes***. This keeps the pixel but
   stops tying opens to the contact. It does **not** remove the pixel. The CNIL rules
   that took effect in 2026 treat transactional mail (OTPs, receipts) as exempt for
   *aggregate* deliverability measurement only, which is how this deployment uses it.
4. **Confirmation sends:** *Settings → Senders* → make sure
   `support@lankalens.online` is a **verified sender**, and don't send campaigns to
   the same addresses from a different sender/brand name — mixing marketing into the
   same sending identity drags transactional mail down with it.
5. **Register the domain with Google Postmaster Tools** (free) so you can see
   Gmail's own view — spam rate, IP/domain reputation, auth results — instead of
   guessing from a single message's headers:
   [postmaster.google.com](https://postmaster.google.com). Verification needs one
   extra TXT record; it does **not** touch SPF, DKIM or DMARC.
   → Now that SPF/DKIM/DMARC all pass, this dashboard is the only place that will
   tell you *why* a message is landing in spam (usually reputation, not headers).

## 4. What the code now does about tracking (`BREVO_PIXEL_TRACKING_CONSENT`)

`server/mailer.js` sends transactional OTP and invoice email through Brevo's v3 API.
Brevo's documented, supported way to stop tracking for a specific message is
**per-contact pixel tracking consent**, passed on each recipient:

```json
"to": [{ "email": "customer@example.com", "contactPixelTrackingConsent": false }]
```

There is no equivalent for the SMTP relay — the HTTP API is the only transport that
can carry this instruction.

**Two-step enablement (order matters):**

1. **In Brevo first:** *Settings → Contacts → **Per-contact pixel tracking consent** =
   Yes*, and set *Track contacts whose consent is unknown* to **No**. This makes the
   consent attributes exist; without it the API does not accept the field.
2. **Then on the server** (Railway → Variables → redeploy):

   ```
   BREVO_API_KEY           = <v3 key with "Transactional" scope>
   BREVO_PIXEL_TRACKING_CONSENT = off
   ```

With the variable unset (the default), the field is **not** sent at all — the app
behaves exactly as before, which is the safe default if the Brevo setting above is
not enabled yet. Verify what the live deployment is using:

```
GET https://<your-app>/api/email/status
→ { "transport": "brevo_api", "brevo_pixel_tracking_consent": "declined", … }
```

Both transactional API sends also carry a Brevo `tags` value
(`password-reset-otp`, `order-confirmation`) so they are easy to isolate in
*Transactional → Logs* and in webhooks, and stay distinguishable from any campaign
traffic in the same Brevo account.

**Expectation management:** even with `BREVO_PIXEL_TRACKING_CONSENT=off`, Brevo still
relays through its own infrastructure, still adds `List-Unsubscribe`, and may still
record aggregate/anonymous opens under the transactional deliverability exemption
(no recipient-level data). Only Brevo Support can guarantee the pixel is removed
entirely. The point of the flag is that **no per-recipient open/click data is
collected from an OTP** — which is the appropriate default for a password reset.

## 5. So why is it still in spam?

With SPF, DKIM and DMARC all passing and clean transactional content, message
headers are no longer the variable — **sender reputation and engagement** are.
`lankalens.online` is young, sends low volume through Brevo's shared pool, and
one-off OTP mail generates very little engagement signal. Practical levers, in order
of impact:

- **Warm up**: keep volume low and steady; don't mix a marketing blast into the same
  sending identity.
- **Drive engagement**: when a customer finds the code in spam, ask them to hit
  *Not spam* / drag it to the inbox once and add `support@lankalens.online` to
  contacts. Repeated "not spam" from real recipients is the strongest available
  signal for a small sender.
- **Watch Google Postmaster Tools** (§3.5) rather than re-reading individual
  messages — it tells you whether the domain or the shared IP is the problem.
- **Keep the reset email exactly as simple as it is** — brand, code, 15-minute
  expiry, "ignore it if you didn't ask". No welcome copy, no offers, no social
  links, no images beyond Brevo's own pixel.
- Consider a **dedicated IP** only once you send at consistent volume (a cold
  dedicated IP with low volume is *worse* than a shared pool).

## 6. Gmail SMTP (alternative transport)

If you ever switch away from Brevo to `smtp.gmail.com` with an App Password:

- Keep `MAIL_FROM` **equal** to `SMTP_USER` (the server logs a warning when they
  differ — mismatched From addresses look like spoofing).
- `@gmail.com` records already exist (Google maintains them), so delivery is usually
  fine once the address has positive history.
- Sending a custom domain through Gmail instead? Add **Gmail → Accounts → Send mail
  as** and answer **YES** to "Treat as alias" so Gmail signs with your domain's DKIM.
- Note this path also removes Brevo's List-Unsubscribe header, because you are no
  longer sending through Brevo. Only switch if you accept losing Brevo's bounce/IP
  management and analytics.

## 7. Reputation habits (mailbox providers watch behaviour)

- **Only transactional mail** from this sender: OTPs and invoices are exactly what
  inboxes like. Never mix marketing blasts into the same address.
- **Keep subjects calm and specific** — "Your PixelHouse password reset code".
- **Avoid link shorteners** and long chains of links in email.
- **Don't chase headers**: if auth passes and content is clean, rewriting headers or
  hiding tracking will not move you to the inbox — and trying to is the wrong road.

## What the code does for you already

- Branded `From` display name (`MAIL_FROM_NAME`) + `Reply-To` (`MAIL_REPLY_TO`) on
  every email, both Brevo API and SMTP transports (`server/mailer.js`)
- Every email ships as **multipart/alternative** (plain text + HTML)
- Calm, specific subjects — no caps/exclamations/spam words
- Order confirmations attach the invoice PDF with a proper `application/pdf`
  content type
- Password-reset OTPs contain no links or images at all
- `BREVO_PIXEL_TRACKING_CONSENT=off` asks Brevo not to track opens/clicks per
  recipient on the API transport (§4)
- Brevo `tags` on both transactional sends, so OTP/invoice traffic is separable
  from campaign traffic in Brevo's logs
- `GET /api/email/status` reports the live transport and tracking mode (no secrets)
