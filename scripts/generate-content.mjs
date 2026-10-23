#!/usr/bin/env node
// scripts/generate-content.mjs
// -----------------------------------------------------------------------------
// Write markdown for every planned page of a site into sites/<slug>/content/.
//
//   npm run content -- --site <slug>              # only missing pages
//   npm run content -- --site <slug> --overwrite  # regenerate everything
//   npm run content -- --site <slug> --template   # skip AI, templates only
//
// Each file gets `reviewed: "false"`. Read it, fix it, flip to "true".
// Risky phrases (rates, guarantees...) are listed in content/_review.json.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { loadSite, planPages, readContent, writeContent, parseArgs } from '../lib/core.mjs';
import { pageMeta, systemPrompt, userPrompt, templateBody, lintBody } from '../lib/content.mjs';
import { generate } from '../lib/llm.mjs';
import { loadEnv } from './env.mjs';

export async function generateContent(slug, { overwrite = false, template = false } = {}) {
  loadEnv();
  const ctx = loadSite(slug);
  const pages = planPages(ctx);
  const system = systemPrompt(ctx);
  const review = {};
  let ai = 0, tpl = 0, skipped = 0;

  console.log(`→ Generating content for ${slug}: ${pages.length} pages`);
  for (const [i, page] of pages.entries()) {
    const existing = readContent(ctx.dir, page.contentFile);
    if (existing && !overwrite) {
      // Kept pages are re-linted so _review.json always reflects every page.
      const kept = lintBody(existing.body);
      if (kept.length) review[page.contentFile] = kept;
      skipped++; continue;
    }

    const meta = pageMeta(page, ctx);
    let body, source;
    const result = template ? null : await generate(system, userPrompt(page, ctx));
    if (result) { body = result.text; source = result.provider; ai++; }
    else { body = templateBody(page, ctx); source = 'template'; tpl++; }

    const issues = lintBody(body);
    if (issues.length) review[page.contentFile] = issues;
    writeContent(ctx.dir, page.contentFile, { ...meta, source, reviewed: 'false' }, body);
    process.stdout.write(`  [${i + 1}/${pages.length}] ${page.url}  (${source})${issues.length ? '  ⚠ ' + issues.join(', ') : ''}\n`);
  }

  const reviewFile = path.join(ctx.dir, 'content', '_review.json');
  fs.mkdirSync(path.dirname(reviewFile), { recursive: true });
  fs.writeFileSync(reviewFile, JSON.stringify(review, null, 2) + '\n');
  console.log(`✓ Content: ${ai} AI, ${tpl} template, ${skipped} kept. ${Object.keys(review).length} page(s) flagged in content/_review.json`);
  if (tpl && !template) console.log('  (Template fallback was used. Start Ollama — `ollama serve` — or add a free API key in .env for AI copy.)');
}

if (process.argv[1]?.endsWith('generate-content.mjs')) {
  const a = parseArgs();
  generateContent(a.site || a._[0], { overwrite: !!a.overwrite, template: !!a.template })
    .catch(e => { console.error('✗', e.message); process.exit(1); });
}
