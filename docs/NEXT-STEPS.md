# Next steps for the operator

Work top to bottom. Each step says where to do it: **Admin** (the local control panel, `npm run admin`), **Terminal**, or **Outside** (a website or a decision).

## Day 1 — get it running on your PC (about 1 hour)

- [ ] **Terminal:** install Node.js 20+ (nodejs.org) and Git.
- [ ] **Terminal:** `git clone https://github.com/bawcejawn/ApexForge && cd ApexForge && npm install`
- [ ] **Terminal:** `npm run admin`, then open http://127.0.0.1:4400
- [ ] **Outside:** install Ollama (ollama.com). **Terminal:** `ollama pull llama3.1:8b`. The Admin → Settings page shows a green "Ollama running" pill when it's working.
- [ ] **Admin → Activity → Run tests:** should end with `# pass 9`.
- [ ] **Admin → Sites → Hill Country Life Quotes → Build & publish → Start preview**, open localhost:4321 and click around the sample site. This is what every site looks like.

## Days 2–3 — decisions only you can make

- [ ] **Pick your first market.** One state, 3–8 cities you actually know. Local knowledge is what makes city pages rank.
- [ ] **Pick your first vertical.** Recommended: life insurance / final expense.
- [ ] **Decide who calls the leads.** You (needs a license, see below) or a buyer. Every lead's consent names one company, so you need that name before launch.
- [ ] **Outside:** form an LLC if you haven't (the site footer, privacy policy and consent need a real legal name and address).
- [ ] **Outside:** buy the domain (Cloudflare Registrar sells at cost, ~$10/yr).
- [ ] **Outside (strongly recommended):** start the life & health insurance license in your state. It's a few hundred dollars and a few weeks of study, and roughly doubles what each life lead is worth to you.

## Days 3–5 — build your first real site (Admin)

- [ ] **Sites → New site:** your brand, domain, state, cities, business details, and the buyer name.
- [ ] **Settings tab:** fill every field highlighted orange (TODO), add a real content reviewer, and write 1–3 verified local facts per city.
- [ ] **Pages & content → Write missing pages** (uses Ollama).
- [ ] **Read every page.** Fix anything wrong, clear red compliance flags, tick "reviewed", "Save & next". This is the step that keeps you out of Google's spam filters and out of legal trouble.
- [ ] **Overview tab:** the launch checklist should be all green.
- [ ] **Outside:** have a lawyer look at the privacy policy, terms and consent wording (one-time, worth it).

## Day 5–6 — go live (Admin + Cloudflare dashboard)

- [ ] **Outside:** create a free Cloudflare account.
- [ ] **Admin → Settings → Cloudflare:** 1. Log in → 2. Create database → 3. Apply schema.
- [ ] **Admin → Settings → Leads:** Generate an ADMIN_TOKEN and save.
- [ ] **Admin → your site → Build & publish:** Build, then Deploy.
- [ ] **Cloudflare dashboard:** follow the 5 one-time steps listed under "Build & publish" (D1 binding, ADMIN_TOKEN, optional Discord/Slack webhook, custom domain, redeploy).
- [ ] **Admin → Settings → Leads:** add your site URL to LEAD_APIS.
- [ ] **Test:** submit the form on your live site with your own phone number, then **Leads → Pull new leads**. You should see it with a tier and score.
- [ ] **Outside:** add the site to Google Search Console and Bing Webmaster Tools, and submit `https://yourdomain/sitemap-index.xml`.

## Weeks 2–4 — first revenue

- [ ] **Outside:** register for National Do Not Call Registry access (free for up to 5 area codes) and scrub before calling.
- [ ] **Outside:** call 10–20 local independent agents. Offer 5 free leads, then a per-lead price with a weekly cap. Exclusive + consented + local is your pitch.
- [ ] **Admin → Leads:** work every lead the same day. Mark status, buyer and price so the Overview shows real revenue.
- [ ] Build a second site (same vertical, next market) once the first one is indexed.

## Months 2–3 — scale what works

- [ ] Look at which pages and cities produced leads; add more cities there (raise `maxCityPages` slowly).
- [ ] Add calculator and cost-guide page types (on the roadmap in PLAN.md).
- [ ] Add a second vertical (real-estate sellers or mortgage) using **Verticals → New vertical**.
- [ ] Revisit Koinos only if the network shows real activity; until then keep Settlement on `none` or `log`.

## Ongoing habits

- Pull leads daily; call within minutes when you can (speed to lead is the biggest close-rate factor).
- Review any regenerated page before rebuilding.
- Commit your changes: `git add -A && git commit -m "..." && git push`. Never commit `.env` or `data/` (already ignored).
