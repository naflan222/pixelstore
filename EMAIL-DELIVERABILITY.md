# Why your emails land in spam — and how to fix it

The store already sends well-formed email (multipart plain-text + HTML, consistent
branded `From:`, `Reply-To:`, calm subjects, no spam-bait wording). If the
password-reset OTP still arrives in spam, the cause is almost always **sender
authentication** — proving to Gmail/Outlook/Yahoo that *your sender* is allowed to
send *as your address*. No code change can replace this step.

## 1. Brevo (what this deployment uses)

You are sending from `support@lankalens.online` **via Brevo** — a custom domain is
exactly the right setup. One step makes mailbox providers fully trust it:

### Authenticate `lankalens.online` in Brevo (do this once)

Until this is done, Brevo signs mail with *its own* domain and `lankalens.online`
publishes nothing — so Gmail/Outlook have no proof the address is yours, and mail
can still land in spam. Fix it permanently:

1. **Add the domain**: Brevo → *Senders, Domains & Dedicated IPs* → **Domains**
   → *Add a domain* → `lankalens.online`.
2. **Publish the records Brevo shows you** at the DNS host for `lankalens.online`.
   They look like this (use Brevo's exact values):

   | Record | Name | Value |
   |---|---|---|
   | DKIM #1 | `mail._domainkey` | (Brevo gives a long TXT value) |
   | DKIM #2 | `mail2._domainkey` | (Brevo gives a long TXT value) |
   | SPF | `@` | `v=spf1 include:_spf.sendinblue.com ~all` |
   | DMARC | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:support@lankalens.online; adkim=s; aspf=s` |

3. **Verify** in Brevo (green check on all records).
4. **Verify the sender**: Brevo → *Senders* → add `support@lankalens.online`
   → click the confirmation email Brevo sends. Without this the relay rejects
   mail with a 550 error.
5. **Railway variables** → redeploy:
   ```
   MAIL_FROM = support@lankalens.online
   MAIL_FROM_NAME = PixelHouse
   MAIL_REPLY_TO = support@lankalens.online
   ```
6. **Test it**: send yourself a password-reset email addressed to the test address
   at [mail-tester.com](https://www.mail-tester.com) — aim for **10/10**. Then send
   a real test order confirmation and check it hits the inbox.

After step 3, every email (OTP + order confirmation with invoice) is DKIM-signed
as `lankalens.online` — the single biggest jump out of spam.

### If you ever fall back to the plain `@gmail.com` sender

- In Brevo, keep the address **verified** (unverified senders get 550s).
- Ask a few early customers to hit *Report not spam* once and add the sender to
  contacts — engagement signals matter most for small senders.
- Expect Gmail-to-Gmail delivery to stay inconsistent; the domain above is the
  real fix.

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
