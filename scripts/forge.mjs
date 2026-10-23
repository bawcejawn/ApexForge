#!/usr/bin/env node
// scripts/forge.mjs
// -----------------------------------------------------------------------------
// THE one command: config -> content -> static build.
//
//   npm run forge -- --vertical life-insurance --brand "Hill Country Life Quotes" \
//     --domain hillcountrylifequotes.com --state TX --state-name "Texas" \
//     --cities "Austin,Round Rock,Georgetown" --email you@domain.com
//
// Re-running is safe: existing site.json and content are kept (use --force /
// --overwrite to regenerate). Add --template to skip AI.
// -----------------------------------------------------------------------------
import { parseArgs } from '../lib/core.mjs';
import { createSite } from './new-site.mjs';
import { generateContent } from './generate-content.mjs';
import { buildSite } from './build.mjs';

const a = parseArgs();
try {
  const slug = a.site || createSite(a);
  await generateContent(slug, { overwrite: !!a.overwrite, template: !!a.template });
  buildSite(slug);
} catch (e) {
  console.error('✗', e.message);
  process.exit(1);
}
