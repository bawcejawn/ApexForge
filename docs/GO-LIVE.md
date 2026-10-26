# Go live: automatic delivery, email and bot check

Do this after **Setup Part 9** (your site is live on Cloudflare). Each part ends with a **✅ Status check**. Everything here uses free plans.

| Part | What you get | Time |
|---|---|---|
| A | A business email address on your domain | 10 min |
| B | Emails that send themselves (to partners, leads and you) | 20 min |
| C | A free bot check that keeps fake leads out | 10 min |
| D | Your first partner receiving leads automatically | 20 min |
| E | Partners paying you online (optional) | 15 min |

---

## How it works

```
Lead submits form ─► checked (bot check, real phone, real email, ZIP, 18+, not a duplicate)
                   ─► scored A / B / C
                   ─► routed to a partner who: covers that city, takes that tier,
                      is under their weekly cap, has prepaid balance, and is named
                      in the consent box the lead agreed to
                   ─► within seconds:
                        • partner gets an email with every answer + their portal link
                        • the lead gets an email naming who will call, with a booking link
                        • you get a Discord/Slack alert
                        • the thank-you page lets the lead book a time with that partner
No partner eligible ─► the lead stays with CPP Holdings LLC for you
```

Nobody has to vet leads by hand. You set prices, caps and areas once, and record payments when partners pay.

---

## Part A — Business email (free, Cloudflare Email Routing)

This forwards `hello@yourdomain.com` to your personal inbox, so partners and leads can reply.

1. Cloudflare dashboard → your domain → **Email → Email Routing → Get started**.
2. Create the address **hello** → destination: your personal email → **Create and continue**. Click the verification link Cloudflare emails you.
3. Click **Add records and enable** (Cloudflare adds the DNS for you).

> **✅ Status check:** email `hello@yourdomain.com` from your phone. It lands in your inbox within a minute.

4. Admin → **Sites → [site] → Settings → Your business → Email**: `hello@yourdomain.com`. Save.

---

## Part B — Automatic emails (free, Resend: 100/day, 3,000/month)

1. Sign up at [resend.com](https://resend.com) with your personal email.
2. **Domains → Add domain** → your domain. Resend shows 3–4 DNS records.
3. In Cloudflare → your domain → **DNS → Records**, add each record exactly as Resend shows it (type, name, value). Leave **Proxy status** off (grey cloud).
4. Back in Resend, click **Verify**. It can take 5–30 minutes.
5. Resend → **API Keys → Create API key** (permission: Sending access). Copy it now; it's shown once.
6. Cloudflare → **Workers & Pages → [site project] → Settings → Variables and secrets**, add:
   - `RESEND_API_KEY` = the key (type **Secret**)
   - `EMAIL_FROM` = `Grand Strand Home Value <hello@yourdomain.com>` (use that site's name and domain)
   - `OPERATOR_EMAIL` = where you want your own lead copies (e.g. your personal email)
7. Admin → **Build & publish → Deploy** (new settings apply on the next deploy).

> **✅ Status check:** submit a test lead with your own email. You receive the "we got your request" email, and `OPERATOR_EMAIL` receives the lead details.

> **⚠️** Repeat steps 2–7 for each site's domain (the free plan allows 3 domains, one per site). Not receiving? Check spam once, then Resend → **Emails** shows whether it was sent or bounced.

---

## Part C — Bot check (free, Cloudflare Turnstile)

1. Cloudflare dashboard → **Turnstile → Add widget**. Name: the site name. Hostname: your domain. Widget mode: **Managed**. Create.
2. Copy the **Site key** → Admin → **Sites → [site] → Settings → Bot check site key**. Save.
3. Copy the **Secret key** → Cloudflare → **Workers & Pages → [site project] → Settings → Variables and secrets** → add `TURNSTILE_SECRET` (Secret).
4. Admin → **Build & publish → Build**, then **Deploy**.

> **✅ Status check:** submit a test lead. It goes through. In the admin, the lead's details show `bot check: passed`. (Most real people never see a puzzle; Turnstile checks silently.)

---

## Part D — Add a partner (realtor, lender or agent)

1. Admin → **Partners → + Add partner**. Name and company exactly as they should appear to consumers ("Jane Smith" of "ABC Realty"), license, lead email, phone, price per lead, weekly cap.
2. On their page:
   - **Where they get leads:** tick the site, then the cities they cover (none ticked = all cities).
   - **Lowest tier:** B is a good start; C leads stay with you.
   - **Booking link:** their Cal.com or Calendly link, if they have one. Leads book with them right after submitting, which raises contact rates a lot.
   - **Save partner.**
3. **Give 5 free pilot leads** (button under Balance & payments). This needs the site to be live.
4. **Rebuild and deploy** the site (Sites → Build & publish). The consent box on that partner's city pages now names them, and the router starts sending them leads.
5. **Copy portal link** and text it to them with a short note: *"Your leads arrive by email the second they come in. This private link shows all of them and lets you request a replacement for a bad one within 72 hours."*

> **✅ Status check:** open one of their city pages on your phone. The consent text names them. Submit a test lead with your own details: the partner gets the email, you get an alert saying "→ Jane Smith of ABC Realty", and their portal shows the lead with the balance reduced. Then open the lead in your admin and set it to **bad** with the note "test" (or approve it as a return so their balance is restored).

**When a partner requests a replacement:** you get an alert. Admin → **Leads → Pull new leads** → open the lead → **Approve (credit them)** or **Reject**.

---

## Part E — Get paid online (optional, Stripe: no monthly fee)

Stripe charges only per payment (about 2.9% + 30¢ for cards), with no monthly fee.

1. Sign up at [stripe.com](https://stripe.com) as **CPP Holdings LLC** (have your EIN and business bank account ready).
2. **Payment Links → New** → product "10 verified leads" at your price (e.g. $500) → create. Copy the link.
3. Admin → **Partners → [partner] → Payment link**: paste it. Save, then rebuild and deploy so the portal shows a **Buy more leads** button when they run low.
4. When Stripe emails you a payment: Admin → **Partners → [partner] → Record payment** → amount + note ("Stripe 10/30").

Prefer Zelle or a check? Skip Stripe and just record payments when they arrive.

---

## Daily routine once live (about 5 minutes)

1. Check alerts on your phone. Nothing to do for routed leads.
2. Leads kept for you (no eligible partner, or life insurance): call or text them from the email.
3. Once a week: **Partners** → glance at balances; nudge anyone running low.
4. Approve or reject any replacement requests.
