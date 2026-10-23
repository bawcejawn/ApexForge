# ApexForge

Generate SEO lead sites for life insurance, mortgage and real estate in one command, host them free on Cloudflare, and capture consented, scored leads you can call or resell.

- **One command** → config, AI content, static site with programmatic city pages
- **$0/month** → Cloudflare Pages + Functions + D1 free tiers; domains are the only cost
- **Local AI first** → Ollama on your GPU, free API fallbacks, template fallback so it never fails
- **Compliance built in** → named-buyer consent with stored proof, content linter, human review gate
- **Optional chain settlement** → pluggable adapter (none / hash-chained log / Koinos)

| Doc | What's in it |
|---|---|
| **[docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)** | Click-by-click Windows setup with a status check after every part |
| **[docs/CALL-SCRIPTS.md](docs/CALL-SCRIPTS.md)** | Call, voicemail and text scripts for life, real estate and mortgage leads, plus the partner pitch |
| [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) | The Horry County launch plan, week by week |
| [docs/PLAN.md](docs/PLAN.md) | Architecture, $50k/month math, verticals, SEO, compliance, Koinos, roadmap |
| [docs/PROJECT-BRIEF.md](docs/PROJECT-BRIEF.md) | The original project brief |
| [koinos/README.md](koinos/README.md) | Optional on-chain settlement layer |

---

## Admin panel (the easy way)

**Windows:** double-click **`Start-ApexForge.cmd`** (first run installs everything). Double-click **`Sync-ApexForge.cmd`** to save your edits to GitHub and pull updates.

**Any OS:**
```bash
npm install
npm run admin        # → http://127.0.0.1:4400
```

A local control panel for everything below, no terminal needed after this:

- **Overview** — setup checklist, sites, lead totals, sold revenue
- **Sites** — create sites; edit brand, cities + local facts, buyers, reviewer, colors; per-site launch checklist
- **Pages & content** — every page with source, word count, compliance flags and review status; Markdown editor with live preview; write/regenerate pages with AI
- **Build & publish** — build, local preview, deploy to Cloudflare, plus the one-time dashboard steps
- **Leads** — pull from live sites, filter/search, a call-ready **quote sheet** (age, BMI, underwriting read, copy button) and a still-to-gather checklist, call/email, set status, buyer, price and notes (syncs back to the live site), view consent proof, export CSV
- **Verticals** — edit services, FAQs, form fields, scoring rules and compliance rules (form view or raw JSON), or create a new vertical
- **Settings** — AI keys/models with Ollama status, admin token generator, Cloudflare login + database setup, settlement mode
- **Guides & scripts** — setup guide, call scripts and plan, printable
- **Activity** — live logs of every build, deploy and content run

It only listens on your own machine (127.0.0.1) and uses a per-launch token, so nothing on your network or other websites can reach it. It edits the same files and runs the same scripts as the CLI below, so you can mix both.

---

## Command line (optional)

Requires Node 20+.

```bash
npm install

# 1. Generate + build a life-insurance site
npm run forge -- --vertical life-insurance --brand "Hill Country Life Quotes" \
  --domain hillcountrylifequotes.com --state TX --state-name "Texas" \
  --cities "Austin,Round Rock,Georgetown,San Marcos" \
  --email leads@hillcountrylifequotes.com

# 2. Preview it
npm run dev -- --site hillcountrylifequotes     # http://localhost:4321
```

That creates `sites/hillcountrylifequotes/` (config + markdown content) and `dist/hillcountrylifequotes/` (the deployable site): home, 4 service guides, 16 city pages, about, partners, privacy, terms, sitemap, robots.

Other verticals: `--vertical mortgage` or `--vertical real-estate`.

### AI content

Without AI running, pages are written from solid templates. For AI copy:

```bash
ollama pull llama3.1:8b      # fits a 3070 Ti's 8 GB
ollama serve
npm run content -- --site hillcountrylifequotes --overwrite
```

Or add a free `GROQ_API_KEY` / `GEMINI_API_KEY` to `.env` (copy `.env.example`). Flagged risky phrases land in `sites/<slug>/content/_review.json`.

---

## Before you launch (the build warns about each of these)

1. **Edit `sites/<slug>/site.json`:** real legal business name, address, email, the **buyer(s)** named in consent, and a real content reviewer in `author`.
2. **Add `localNotes`** for each city (verified local facts). This is what keeps city pages from looking mass-produced.
3. **Read every page** in `sites/<slug>/content/`, fix anything off, and set `reviewed: "true"`.
4. **Have a lawyer review** `src/pages/privacy.astro`, `terms.astro`, and the consent text in `src/lib/site.mjs`.
5. Read the compliance section of [docs/PLAN.md](docs/PLAN.md#4-compliance-read-before-collecting-a-single-lead).

## Deploy to Cloudflare (free)

```bash
npx wrangler login
npx wrangler d1 create apexforge-leads          # once; paste database_id into wrangler.toml
npx wrangler d1 execute apexforge-leads --remote --file db/schema.sql

npm run build  -- --site hillcountrylifequotes
npm run deploy -- --site hillcountrylifequotes
```

Then once per site in the Cloudflare dashboard → **Workers & Pages → your project → Settings**:

- **Bindings:** add D1 database, variable name `DB`, database `apexforge-leads`
- **Variables and secrets:** `ADMIN_TOKEN` (24+ random characters), optionally `NOTIFY_WEBHOOK` (a Discord or Slack webhook URL for instant lead alerts)
- **Custom domains:** add your domain

Redeploy after adding bindings. Submit `https://yourdomain/sitemap-index.xml` in Google Search Console.

## Working your leads

```bash
# .env: ADMIN_TOKEN=... and LEAD_APIS=https://hillcountrylifequotes.com
npm run leads                                     # → data/leads.csv
npm run leads -- --set <lead-id> --status sold --buyer "Example Agency" --price 60
```

Statuses: `new → contacted → qualified → sold → returned`, plus `dnc` and `bad`. Every lead carries a score (0–100), tier (A/B/C) and suggested price from the vertical's `scoring` rules.

## Test locally without Cloudflare

```bash
npm test     # lead API, scoring, consent, bot traps, dedupe, rate limit, admin API, ledger

# Full local runtime (real Workers runtime + local D1):
npx wrangler d1 execute apexforge-leads --local --file db/schema.sql
npx wrangler pages dev dist/hillcountrylifequotes \
  --d1 DB=00000000-0000-0000-0000-000000000000 --binding ADMIN_TOKEN=local-test-token-123456789
```

---

## Project layout

```
admin/              local control panel: server.mjs (API) + ui/ (plain JS, no build step)
verticals/          one JSON per vertical: services, form, scoring, compliance rules
sites/<slug>/       site.json (brand, cities, buyers) + content/*.md (generated, reviewable)
lib/
  core.mjs          config loading + page plan (shared by generator and Astro)
  content.mjs       SEO metadata, AI prompts, template fallback, compliance linter
  llm.mjs           Ollama → Groq → Gemini → OpenRouter chain
  scoring.mjs       phone/email validation, lead scoring (runs in Workers and Node)
  lead-handler.mjs  lead API logic (unit tested)
  settlement.mjs    settlement adapter: none | log | koinos
src/                Astro template (layout, form, pages) — builds whichever SITE is set
functions/api/      Cloudflare Pages Functions: /api/lead, /api/leads
db/schema.sql       D1 table with consent-proof columns
scripts/            forge, new-site, generate-content, build, deploy, pull-leads
koinos/             optional: koilib client + AssemblyScript LeadRegistry contract sketch
docs/PLAN.md        architecture, monetization, verticals, SEO, compliance, roadmap
tests/              node:test suites
```

## Adding a vertical

Copy `verticals/life-insurance.json` to `verticals/solar.json`, change services, form fields, scoring rules and compliance text, then `npm run forge -- --vertical solar ...`. No code changes.
