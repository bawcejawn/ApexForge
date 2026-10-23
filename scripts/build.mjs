#!/usr/bin/env node
// scripts/build.mjs
// -----------------------------------------------------------------------------
// Build one site to dist/<slug>/ (static HTML, ready for Cloudflare Pages).
//   npm run build -- --site <slug>
//   npm run dev   -- --site <slug>     # live preview at http://localhost:4321
// One Astro codebase builds every site; SITE env var selects which one.
// -----------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSite, parseArgs } from '../lib/core.mjs';
import { writeRegistry } from './registry.mjs';

export function buildSite(slug, { dev = false } = {}) {
  const { site, dir } = loadSite(slug); // validates

  // Pre-launch checklist: every TODO left in site.json is a launch blocker.
  const { _comment, ...cfg } = site;
  const todos = JSON.stringify(cfg).match(/TODO[^"]*/g) || [];
  if (todos.length) {
    console.warn(`⚠ ${todos.length} TODO value(s) in sites/${slug}/site.json — fine for preview, fix before launch:`);
    for (const t of [...new Set(todos)].slice(0, 8)) console.warn(`   - ${t}`);
  }
  const unreviewed = countUnreviewed(path.join(dir, 'content'));
  if (unreviewed) console.warn(`⚠ ${unreviewed} page(s) not yet human-reviewed (reviewed: "false").`);

  writeRegistry(); // keep the lead API in sync with every site's config

  const astro = path.join(ROOT, 'node_modules', 'astro', 'astro.js');
  const args = dev ? [astro, 'dev'] : [astro, 'build', '--outDir', path.join('dist', slug)];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SITE: slug, APEXFORGE_ROOT: ROOT, ASTRO_TELEMETRY_DISABLED: '1' } });
  if (r.status !== 0) throw new Error('Astro build failed');
  if (!dev) console.log(`✓ Built dist/${slug}/  →  deploy with: npm run deploy -- --site ${slug}`);
}

function countUnreviewed(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countUnreviewed(p);
    else if (e.name.endsWith('.md') && /reviewed: "false"/.test(fs.readFileSync(p, 'utf8'))) n++;
  }
  return n;
}

if (process.argv[1]?.endsWith('build.mjs')) {
  const a = parseArgs();
  try { buildSite(a.site || a._[0], { dev: !!a.dev }); }
  catch (e) { console.error('✗', e.message); process.exit(1); }
}
