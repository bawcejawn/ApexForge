#!/usr/bin/env node
// scripts/deploy.mjs
// -----------------------------------------------------------------------------
// Deploy dist/<slug> to Cloudflare Pages (free). The ./functions folder (lead
// API) is bundled automatically by wrangler.
//   npx wrangler login                       # once
//   npm run deploy -- --site <slug>
// First deploy creates the Pages project. Then, once, in the Cloudflare
// dashboard -> Pages -> <slug> -> Settings -> Bindings: add D1 binding "DB"
// -> apexforge-leads, and env vars ADMIN_TOKEN (+ optional NOTIFY_WEBHOOK).
// -----------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from '../lib/core.mjs';

const a = parseArgs();
const slug = a.site || a._[0];
const out = path.join(ROOT, 'dist', slug || '');
if (!slug || !fs.existsSync(out)) {
  console.error(`✗ Build first: npm run build -- --site ${slug || '<slug>'}`);
  process.exit(1);
}
const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const r = spawnSync(process.execPath,
  [wrangler, 'pages', 'deploy', out, '--project-name', slug, '--branch', a.branch || 'main'],
  { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
