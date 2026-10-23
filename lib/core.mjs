// lib/core.mjs
// -----------------------------------------------------------------------------
// Shared config loader + page planner. Used by:
//   - scripts/*.mjs (generator, content writer)
//   - the Astro build (src/lib/site.mjs re-exports from here)
// A "site" = sites/<slug>/site.json merged with verticals/<vertical>.json.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// During `astro build` this file is bundled into dist/, so import.meta.url
// lies. scripts/build.mjs passes APEXFORGE_ROOT; otherwise derive it.
const derived = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = process.env.APEXFORGE_ROOT ||
  (fs.existsSync(path.join(derived, 'verticals')) ? derived : process.cwd());
export const SITES_DIR = path.join(ROOT, 'sites');
export const VERTICALS_DIR = path.join(ROOT, 'verticals');

export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Replace {{key}} tokens with values from `vars`. Unknown tokens are left as-is. */
export const fill = (tpl, vars) =>
  String(tpl ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] ?? m));

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadVertical(id) {
  const file = path.join(VERTICALS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    const have = fs.readdirSync(VERTICALS_DIR).map(f => f.replace('.json', '')).join(', ');
    throw new Error(`Unknown vertical "${id}". Available: ${have}`);
  }
  return readJSON(file);
}

/** Load a site + its vertical. Throws with a helpful message if missing. */
export function loadSite(slug) {
  if (!slug) throw new Error('No site slug given. Set SITE=<slug> or pass --site <slug>.');
  const dir = path.join(SITES_DIR, slug);
  const file = path.join(dir, 'site.json');
  if (!fs.existsSync(file)) throw new Error(`Site "${slug}" not found at ${file}. Run "npm run new-site" first.`);
  const site = readJSON(file);
  const vertical = loadVertical(site.vertical);
  const primaryCity = site.cities[0];
  const vars = {
    brand: site.brand, state: site.state, stateName: site.stateName || site.state,
    city: primaryCity?.name || site.stateName, domain: site.domain
  };
  return { site, vertical, dir, vars };
}

/**
 * The page plan: every URL the site will have, with what it's about.
 * Generator and Astro both use this so they never disagree.
 */
export function planPages({ site, vertical }) {
  const pages = [{ kind: 'home', url: '/', contentFile: 'home.md' }];
  const cities = site.cities.slice(0, site.maxCityPages ?? 25);
  for (const svc of vertical.services) {
    pages.push({ kind: 'service', url: `/${svc.slug}/`, service: svc, contentFile: `${svc.slug}/index.md` });
    for (const city of cities) {
      pages.push({
        kind: 'local', url: `/${svc.slug}/${city.slug}/`, service: svc, city,
        contentFile: `${svc.slug}/${city.slug}.md`
      });
    }
  }
  return pages;
}

/** Parse a markdown file with simple `key: value` frontmatter. */
export function readContent(siteDir, rel) {
  const file = path.join(siteDir, 'content', rel);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { data, body: m[2] };
}

export function writeContent(siteDir, rel, data, body) {
  const file = path.join(siteDir, 'content', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fm = Object.entries(data).map(([k, v]) => `${k}: "${String(v).replace(/"/g, "'")}"`).join('\n');
  fs.writeFileSync(file, `---\n${fm}\n---\n${body.trim()}\n`);
}

/** Minimal --flag value parser for CLI scripts (no dependency). */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
