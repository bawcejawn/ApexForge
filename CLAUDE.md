# ApexForge — notes for Claude Code

Zero-recurring-cost lead-site generator. Read `docs/PLAN.md` for the why, `docs/NEXT-STEPS.md` for the operator's checklist.

## How it fits together
- `verticals/*.json` + `sites/<slug>/site.json` are the source of truth. `lib/core.mjs → planPages()` turns them into the URL list; the generator and Astro both use it.
- One Astro project (`src/`) builds any site: `SITE=<slug>` (set by `scripts/build.mjs`).
- Lead API logic lives in `lib/lead-handler.mjs` (pure, unit-tested); `functions/api/*.js` are thin Cloudflare wrappers. `lib/scoring.mjs` must stay dependency-free (runs in Workers).
- Admin panel: `admin/server.mjs` (node:http, no deps, 127.0.0.1 only, per-launch token) + `admin/ui/` (plain ES modules, no build step). It edits the same files and spawns the same scripts as the CLI.

## Rules
- Run `npm test` after changing anything in `lib/`.
- Never put PII on chain; `lib/settlement.mjs` enforces a field allowlist.
- In the admin UI, insert user/lead data with `textContent` (the `h()` helper), never `innerHTML`. Lead fields come from the public internet.
- Consent text (`src/lib/site.mjs → consentText`) and the consent columns in `db/schema.sql` are legal records; don't weaken them.
- Keep heavy comments and small, incremental commits. The operator vibe-codes and reads the code to learn it.
- Never commit `.env`, `data/`, or `.trash/`.
