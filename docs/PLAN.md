# ApexForge — Architecture, Business Model & Roadmap

*Written October 2026. Numbers are planning assumptions, not guarantees. Verify legal points with a lawyer in your state before launch.*

---

## 1. Architecture and data flow

```
 ┌───────────────────────────── YOUR PC (3070 Ti) ─────────────────────────────┐
 │                                                                              │
 │  verticals/*.json ──┐                                                        │
 │  (services, form,   │     npm run forge                                      │
 │   scoring, rules)   ├──►  new-site ──► generate-content ──► build            │
 │  sites/<slug>/      │     (config)     Ollama → Groq/Gemini   Astro → static  │
 │   site.json ────────┘                  → template fallback    dist/<slug>/   │
 │                                        + compliance linter                   │
 │                                        + human review flag                   │
 └──────────────────────────────────────────────┬───────────────────────────────┘
                                                │ npm run deploy (wrangler)
 ┌──────────────────────── CLOUDFLARE (free tier) ▼─────────────────────────────┐
 │  Pages: static HTML/CSS (CDN, HTTPS, custom domain)                          │
 │  Functions: POST /api/lead ─► validate · bot traps · rate limit · dedupe     │
 │                               score/tier/price · store consent proof         │
 │                               └─► D1 (SQLite)  └─► Discord/Slack webhook     │
 │             GET/PATCH /api/leads (Bearer ADMIN_TOKEN) ◄──────────┐           │
 └──────────────────────────────────────────────────────────────────┼───────────┘
                                                                    │
 ┌─────────────────────────── OPERATOR ─────────────────────────────┴───────────┐
 │  npm run leads ─► data/leads.json + leads.csv (Excel/Sheets = your CRM)      │
 │  Call it yourself  ──or──  sell to a named buyer ─► mark sold ─► settlement  │
 │                                                     (none | log | koinos)    │
 └──────────────────────────────────────────────────────────────────────────────┘

 Traffic: Google organic ─► service/city pages ─► form ─► /api/lead
```

**Stack decisions (and changes from the brief):**

| Piece | Choice | Why |
|---|---|---|
| Site generator | **Astro** (kept) | Static output, near-perfect Core Web Vitals, one codebase builds every site via `SITE=<slug>`. |
| Hosting | **Cloudflare Pages** (kept) | Free, unlimited static bandwidth, custom domains, and Functions for the API on the same domain. Cloudflare now nudges new projects toward Workers Static Assets; moving later is a small config change. |
| Lead storage | **D1** instead of local SQLite/JSON | A static site has no server to write a local file. D1 is SQLite on Cloudflare's free tier (5 GB). Your local copy comes from `npm run leads`. |
| Notifications | **Discord/Slack webhook** instead of email | Email *sending* from Workers no longer has a reliable free path. A webhook to a private channel is free and instant on your phone. |
| AI | **Ollama 7–9B** first | 3070 Ti has 8 GB VRAM: `llama3.1:8b`, `qwen2.5:7b`, `gemma2:9b` run well. 13B+ spills to CPU. Groq / Gemini / OpenRouter free tiers as fallback, templates last so builds never fail. |
| FAQs + schema | **Human-written, in config** | AI never writes FAQ schema, so structured data never contains hallucinated claims. |
| Chain | **Pluggable settlement adapter** | Koinos is optional behind `lib/settlement.mjs` (see section 5). |

**Running cost:** domains (~$10–15/yr each). Everything else fits free tiers until roughly tens of thousands of leads per day.

---

## 2. Monetization model: a realistic path to $50k/month

### Unit economics per lead

| Vertical | Exclusive lead price (consented, verified) | Notes |
|---|---|---|
| Life – term/whole | $25–$60 | Higher for $250k+ coverage, ages 30–59 |
| Life – final expense | $30–$70 | Ages 50–80; strongest self-close vertical |
| Mortgage – purchase/refi | $40–$120 | "Ready now" + 680+ credit at the top |
| Real estate – seller | $50–$150 | Sellers worth far more than buyers |
| Real estate – buyer | $20–$60 | |
| Solar (homeowner) | $50–$150 | Credit/roof/ownership filters matter |
| Annuities / retirement | $50–$150 | Asset-qualified only |
| Medicare | $25–$60 | Seasonal (AEP), heavy CMS rules |
| Personal injury | $100–$500+ | Case-type dependent, strict bar rules |

What you actually keep per raw lead:

```
net per raw lead = price × sell-through × (1 − return rate)
                 = $50   × 0.70         × (1 − 0.15)        ≈ $30
```

Buyers return bad numbers and duplicates; plan on 10–20% returns and 60–80% sell-through.

### The math for $50k/month

| Path | What it takes |
|---|---|
| Pure resale at ~$30 net | ~1,700 raw leads/mo ≈ 40,000 targeted visitors/mo at 4% form conversion ≈ **20–40 mature sites** |
| Self-close life (licensed) | Final expense commissions often run ~80–120% of first-year premium. If an average sale nets ~$700 and you close 1 in 10 of your own fresh leads, each lead is worth **~$70**: about 2× resale. ~700 leads/mo ≈ $50k |
| **Hybrid (recommended)** | Close life/final-expense leads yourself; resell mortgage and real-estate leads you can't legally close. |

**The biggest lever is getting a life/health insurance license.** It costs a few hundred dollars and a few weeks of study in most states, doubles the value of every life lead, and removes the hardest problem in resale (finding buyers who pay on time).

### Timeline, honestly

- **Months 0–3:** Sites live, indexed, first long-tail rankings. Tens of leads per month. Learn what converts.
- **Months 3–9:** Rankings mature on low-competition city pages; 100–500 leads/month across a handful of sites. First buyer relationships.
- **Months 9–24:** Portfolio of 20–40 sites, reinvest in more domains, possibly paid traffic once cost-per-lead is known. $50k/month becomes plausible here, not in month two.

Finance is "Your Money or Your Life" territory, where Google favors trusted brands. New domains rank slowly. Plan cash flow for that.

### Buyers

Start with **local independent agents and loan officers** (call them, offer 5 free leads, then price per lead with a weekly cap). They pay more for exclusive, consented, local leads than aggregators do. Aggregator ping-trees are a fallback for overflow.

---

## 3. Verticals and programmatic SEO

### Launch order

1. **Life insurance** (built). Self-close once licensed. Final expense + mortgage protection are the high-intent pages.
2. **Real estate sellers** (config built). "What is my home worth" + "sell my house" per city.
3. **Mortgage** (config built). Purchase, refi, HELOC, VA.
4. **Solar** — strong prices, lighter regulation than finance. Filter for homeowners.
5. **Annuities / retirement** — high value, asset-qualified forms.
6. **Medicare** — only once you've set up CMS-compliant disclosures; target the next enrollment season (AEP runs Oct 15 – Dec 7, so it's live now, but too late to rank a new site this year).
7. **Personal injury** — highest prices, strictest rules (attorney advertising and referral-fee bans vary by state). Last.

Add a vertical by copying `verticals/life-insurance.json`; no code changes needed.

### Page types per site

| Type | URL | Purpose |
|---|---|---|
| Home | `/` | Brand + form above the fold |
| Service hub | `/final-expense-insurance/` | State-level guide; links to all city pages |
| Service × city | `/final-expense-insurance/round-rock-tx/` | Long-tail local intent; this is the volume engine |
| *(next)* Calculators | `/life-insurance-calculator/` | Earn links, rank for "how much do I need", convert well |
| *(next)* Cost / eligibility guides | `/final-expense-insurance-cost/` | High-intent informational queries |

### Staying on the right side of Google

Google's spam policies target **scaled, low-value content**, which is exactly what careless programmatic sites produce. The generator has guardrails built in:

- **Start with 20–50 pages per site,** not 5,000. `maxCityPages` caps this.
- **Local facts per city** (`localNotes` in site.json): employers, housing costs you've verified, local hospitals or retirement communities. The AI must use them and is told not to invent others.
- **Human review gate:** every page starts `reviewed: "false"`; the build warns until you read it. A named reviewer (`site.author`) appears on reviewed pages.
- **Compliance linter** flags rates, prices, "guaranteed", approval and government claims.
- **Technical SEO:** canonical URLs, sitemap, robots, Organization/Service/Breadcrumb/FAQ schema, internal linking mesh (other cities, other services), fast static pages.

Off-page: submit to Google Search Console and Bing Webmaster Tools, list on relevant local directories, and get links from the agents who buy your leads. Don't create a Google Business Profile without a real staffed location; that gets suspended.

---

## 4. Compliance (read before collecting a single lead)

This is what separates a lead business from a lawsuit. Not legal advice.

- **TCPA consent.** The FCC's 2023 "one-to-one" rule (consent per named seller) was struck down in court in early 2025, but buyers and carriers still demand seller-specific consent, and TCPA class actions are expensive. ApexForge's form names the specific buyer(s) in the consent text, the checkbox is unchecked by default, and the exact text, timestamp, IP, user agent and page URL are stored with every lead. **Sell each lead only to the company named when it was captured.** Many buyers also require a TrustedForm or Jornaya certificate (paid services); budget for one when you start reselling at volume.
- **Do Not Call.** Scrub numbers against the National DNC Registry and state lists before you or buyers call (SAN access is free for up to 5 area codes).
- **Insurance licensing.** Some states require a license to *sell* insurance leads or to discuss specific products. Check your state's department of insurance.
- **Mortgage (RESPA §8).** Paying or receiving referral fees for settlement services is prohibited. Selling leads at a flat, fair-market price that doesn't depend on whether a loan closes is the generally accepted structure. Don't quote rates (Regulation Z advertising rules).
- **Real estate.** Referral fees contingent on closing generally require a real estate license. Flat-fee lead sales are the alternative. Fair Housing rules apply to how neighborhoods are described (the linter rules cover this).
- **Medicare.** CMS rules for third-party marketing organizations are strict (required disclaimers, limits on sharing beneficiary data). Get a compliance review first.
- **Privacy.** The privacy policy and terms templates must match what you actually do. Several states now have consumer privacy laws; honoring deletion and opt-out requests for everyone is simplest.

---

## 5. Koinos layer

Designed, sketched, and **off by default**. Full detail in `koinos/README.md`.

- **Invisible UX:** the operator's key signs everything and its KOIN generates the mana that pays for it. Consumers and buyers never see a wallet or fee. Buyers verify leads by hash with free reads.
- **On-chain data:** lead hash, vertical, tier, status, pseudonymous buyer ID, price. **Never PII** (the adapter rejects it).
- **Contract:** `LeadRegistry` enforces "a lead can be sold exactly once" and keeps lifecycle state; Koinos's in-place contract upgrades let this evolve without migration.
- **Reality check:** KOIN's market cap is under $1M with about $1k in daily volume and a ~97% one-year decline. **Settle money in USD.** Use `SETTLEMENT=log` (free, hash-chained, tamper-evident) now; switch to Koinos only if the network shows signs of life.

---

## 6. Roadmap

**Done:** one-command site generation, lead API with consent proof and scoring, CSV CRM, 3 vertical configs, tests, and the local admin panel (sites, content review, verticals, leads CRM, settings, deploys).

**Next 30 days**
- Buy 2–3 domains; fill in real business info, buyer names, and local notes; review every page; launch.
- Add calculator page type and cost/eligibility guide type.
- Search Console + IndexNow submission script.
- Admin: buyer list with per-buyer lead export and invoicing totals.

**60–90 days**
- Buyer portal: each buyer gets a token and sees only their leads; return requests with reasons.
- Automatic routing: per-buyer caps, ZIP filters, tier pricing.
- Solar + annuity vertical configs.

**Productizing (later)**
- Each customer runs on *their own* free Cloudflare account, so it stays zero-cost for both of you. ApexForge becomes a CLI + web UI that generates their configs and deploys to their account.
- Sell as a one-time license or setup fee, not SaaS (no standing infrastructure for you to pay for).
