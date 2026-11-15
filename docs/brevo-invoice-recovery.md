# PixelHouse invoice email recovery — 15 November 2026

## What this changes

- Website checkout continues creating an order and invoice even if Brevo delivery fails.
- Admin > Orders > View order now offers **Email invoice again** for an existing web or offline order.
- The owner/admin/order-manager-only POST `/api/admin/orders/:id/email-invoice` regenerates the **same invoice number** and PDF and sends to the original stored customer email. It does **not** recreate the order, adjust stock, or alter payment state. It is rate-limited (five requests per minute per requesting IP).
- The action requires explicit confirmation and gives the provider's acceptance/failure status. Acceptance is **not** proof of inbox delivery; check Brevo Transactional Logs for that.
- A Brevo API error that explicitly identifies a blocked/unauthorized IP now includes safe troubleshooting guidance. It **never** authorizes an IP automatically.
- No Brevo keys, server variables, domain/DNS settings, customer orders, or live website data are changed by this code patch.

## Check the real root cause (hosting + Brevo)

1. On your Pixelhouse server in Railway, open your service's **Variables** (do not share their values). Confirm `BREVO_API_KEY` exists and `MAIL_FROM` is a sender verified in Brevo. `MAIL_REPLY_TO` is optional. Redeploy only when you intentionally change a variable.
2. Visit `https://pixelhouse.lk/api/email/status` on the deployed site. `email_enabled: true` and `transport: brevo_api` mean the variables are present; **they do not prove the key is valid or that email works**.
3. In Railway service logs, look for `[EMAIL ERROR]` or `[admin invoice]` near an actual failed order. A response saying blocked/unauthorized IP means Brevo security settings must be investigated. Check 401/403 (key, permission, or IP) and 400 (sender/payload).
4. In Brevo, open **Settings > Security > Authorized IPs** and review unauthorized calls; compare the unknown IP/time with the verified *outbound* IP and logs of your Railway service. A US geolocation alone neither proves nor disproves that it came from Railway. Dynamic cloud egress addresses can change: use documented stable egress if fixed allowlisting is needed.
5. **Only if** the IP is confirmed to be an authorized sending server, approve it in Brevo. If unfamiliar, deny it, rotate the impacted API key in Brevo, update `BREVO_API_KEY` privately in Railway, and remove the old key. Never paste the full key in a chat, GitHub, screenshot or ticket. Enable account 2FA.
6. In Brevo **Transactional > Logs**, check whether a test invoice was accepted, deferred, rejected or delivered. Avoid creating a second real order just to test. In Admin > Orders, open an existing order and select **Email invoice again** after the configuration is corrected.

## Verification after merging and deploying

- Run automated API tests using the project's existing `npm test` workflow; no real customer or production send is required for these tests.
- Reopen the web admin; choose an existing order with a valid recipient and review the PDF invoice before triggering a manual resend.
- A rejected Brevo send shows an error and leaves the original order available to retry later.
- For a newly placed customer checkout order, the site submits the same confirmation mail automatically after checkout. If rejected, it is logged and can be resent from Admin > Orders without generating a duplicate sale.

> This code cannot fix an external provider block or validate live credentials. No live email has been sent by this patch.
