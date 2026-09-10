# Why your emails land in spam — and how to fix it

The store already sends well-formed email (multipart plain-text + HTML, consistent
branded `From:`, `Reply-To:`, calm subjects, no spam-bait wording). If the
password-reset OTP still arrives in spam, the cause is almost always **sender
authentication** — proving to Gmail/Outlook/Yahoo that *your sender* is allowed to
send *as your address*. No code change can replace this step.

## 1. Brevo (what this deployment uses)

You are sending from `mnaflan295@gmail.com` **via Brevo**. Two things fix
deliverability here, in order of impact:

### a) Authenticate your own domain in Brevo (best fix)

Sending from a `@gmail.com` address through a third-party relay is the weakest
setup — Gmail's DMARC makes any relayed mail look suspicious. Instead:

1. Get a cheap domain (or use one you own, e.g. `pixelhouse.lk`).
2. In Brevo: **Senders, Domains & Dedicated IPs → Domains → Add a domain**.
3. Brevo gives you **DKIM (2 TXT records) + SPF (include `_spf.sendinblue.com` in
   your SPF) + DMARC** records — copy them into your DNS provider (Cloudflare,
   Namecheap, GoDaddy, cPanel…) and click *Verify* in Brevo.
4. Create a sender like `orders@yourdomain.com`, verify it, and set
   `MAIL_FROM = orders@yourdomain.com` on Railway (keep `MAIL_FROM_NAME = PixelHouse`).

After this, Brevo signs every email with your domain's DKIM — the single biggest
jump out of spam. Your address also stops depending on `@gmail.com` reputation.

### b) If you must keep the plain `@gmail.com` sender

- In Brevo, make sure the address stays **verified** (unverified senders get 550s).
- Ask a few early customers to hit *Report not spam* once and add the sender to
  contacts — engagement signals matter most for small senders.
- Expect Gmail-to-Gmail delivery to stay inconsistent; step (a) is the real fix.

## 2. Gmail SMTP (direct, no Brevo)

If you switch to `smtp.gmail.com` with an App Password:

- Keep `MAIL_FROM` **equal** to `SMTP_USER` (the server logs a warning when they
  differ — mismatched From addresses get flagged as spoofing).
- `@gmail.com` records already exist (Google maintains SPF/DKIM/DMARC), so
  Gmail-to-Gmail usually lands in the inbox once the address has positive history.
- Sending a custom domain through Gmail instead? Add
  **Gmail → Accounts → Send mail as** for that address and answer **YES** to
  "Treat as alias", so Gmail signs it with your domain's DKIM.

## 3. DNS records cheat-sheet (custom domain `yourdomain.com`)

| Record | Name | Value |
|---|---|---|
| SPF | `@` | `v=spf1 include:_spf.sendinblue.com include:_spf.google.com ~all` |
| DMARC | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com; adkim=s; aspf=s` |
| DKIM | Brevo: two `mail._domainkey` TXT records<br>Gmail Workspace: `google._domainkey` (Admin console → Gmail → Authenticate email) | provided by the provider |

Verify afterwards with [mail-tester.com](https://www.mail-tester.com) — send a
test to the address it shows you and aim for **10/10** — or
[Google Admin Toolbox](https://toolbox.googleapps.com/apps/checkmx/).

## 4. Reputation habits (mailbox providers watch behaviour)

- **Warm up**: a brand-new sender blasting hundreds of emails looks like spam.
  Keep volume low for the first weeks.
- **Only transactional mail**: OTPs and invoices are exactly what inboxes like.
  Never mix marketing blasts into the same address.
- **Ask early customers** to mark the mail *Not spam* / add to contacts once.
- **Avoid link shorteners** and long chains of links in emails.

## What the code does for you already

- Branded `From` display name (`MAIL_FROM_NAME`) + `Reply-To` (`MAIL_REPLY_TO`)
  on every email, both Brevo API and SMTP transports (`server/mailer.js`)
- Console warning when an SMTP `From:` domain doesn't match the SMTP login
- Every email ships as **multipart/alternative** (plain text + HTML)
- Calm, specific subjects — no caps/exclamations/spam words
- Order confirmations attach the invoice PDF with a proper `application/pdf`
  content type
