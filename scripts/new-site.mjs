#!/usr/bin/env node
// scripts/new-site.mjs
// -----------------------------------------------------------------------------
// Create sites/<slug>/site.json for a new lead site.
//
// Example:
//   npm run new-site -- --vertical life-insurance --brand "Hill Country Life Quotes" \
//     --domain hillcountrylifequotes.com --state TX --state-name "Texas" \
//     --cities "Austin,Round Rock,Georgetown,San Marcos" \
//     --email leads@hillcountrylifequotes.com --legal-name "Your LLC" \
//     --address "123 Main St, Austin, TX 78701" \
//     --buyer "Example Life Agency LLC|TX License #0000000"
//
// Anything you skip gets a placeholder you MUST edit before going live
// (the build warns about every "TODO" it finds).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { SITES_DIR, slugify, parseArgs, loadVertical } from '../lib/core.mjs';

export function createSite(args) {
  const vertical = args.vertical || 'life-insurance';
  loadVertical(vertical); // fails fast on a typo
  const brand = args.brand || 'TODO Brand Name';
  const slug = args.slug || slugify(args.domain?.replace(/\.[a-z]+$/, '') || brand);
  const cities = String(args.cities || 'TODO City').split(',').map(s => s.trim()).filter(Boolean);
  const buyers = [].concat(args.buyer || []).map(b => {
    const [name, license] = String(b).split('|');
    return { name: name.trim(), license: (license || '').trim() };
  });

  const site = {
    _comment: 'Edit freely. Anything containing TODO must be replaced before launch.',
    slug,
    brand,
    domain: args.domain || `${slug}.pages.dev`,
    vertical,
    state: args.state || 'TODO',
    stateName: args['state-name'] || args.state || 'TODO',
    cities: cities.map(name => ({
      name,
      slug: slugify(`${name}-${args.state || ''}`),
      // Local facts make city pages genuinely different (and keep them out of
      // Google's "scaled content abuse" bucket). Fill these in by hand.
      localNotes: ''
    })),
    maxCityPages: Number(args['max-cities'] || 25),
    operator: {
      legalName: args['legal-name'] || 'TODO Legal Business Name LLC',
      address: args.address || 'TODO Street, City, ST ZIP',
      email: args.email || 'TODO@example.com'
    },
    // The named company(ies) the consumer consents to be contacted by.
    // One buyer per lead = clean, defensible TCPA consent. If you call leads
    // yourself, list your own business here.
    buyers: buyers.length ? buyers : [{ name: args['legal-name'] || 'TODO Legal Business Name LLC', license: '' }],
    // A real person reviewing content is the strongest E-E-A-T signal you can add.
    author: { name: args.author || 'TODO Reviewer Name', credentials: args.credentials || '', bio: '' },
    theme: { primary: args.primary || '#0f3d3e', accent: args.accent || '#e0a526' },
    analytics: { cloudflareBeaconToken: '' }
  };

  const dir = path.join(SITES_DIR, slug);
  if (fs.existsSync(path.join(dir, 'site.json')) && !args.force) {
    console.log(`• sites/${slug}/site.json already exists (use --force to overwrite). Keeping it.`);
    return slug;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(site, null, 2) + '\n');
  console.log(`✓ Created sites/${slug}/site.json (${vertical}, ${cities.length} cities)`);
  return slug;
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('new-site.mjs')) {
  createSite(parseArgs());
}
