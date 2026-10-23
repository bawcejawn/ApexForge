#!/usr/bin/env node
// admin/server.mjs
// -----------------------------------------------------------------------------
// ApexForge Admin — a local control panel for the whole program.
//
//   npm run admin            → http://127.0.0.1:4400
//
// Runs ONLY on your PC (binds to 127.0.0.1). It edits the same files you'd edit
// by hand (sites/, verticals/, content/, .env) and runs the same npm scripts,
// so the CLI and the admin are always interchangeable.
//
// Security model:
//   - Listens on 127.0.0.1 only (not reachable from your network).
//   - Every API call needs the per-launch token injected into the page, which
//     blocks other websites in your browser from calling this API (CSRF).
//   - Host header must be localhost/127.0.0.1 (blocks DNS-rebinding attacks).
//   - All file paths are validated so nothing outside the project can be read
//     or written.
// No dependencies beyond Node 20+.
// -----------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ROOT, SITES_DIR, VERTICALS_DIR, readJSON, loadSite, planPages, readContent, writeContent, slugify, parseArgs
} from '../lib/core.mjs';
import { lintBody } from '../lib/content.mjs';
import { createSite } from '../scripts/new-site.mjs';
import { loadEnv } from '../scripts/env.mjs';

loadEnv();
const args = parseArgs();
const PORT = Number(args.port || process.env.ADMIN_PORT || 4400);
const TOKEN = crypto.randomBytes(24).toString('hex');
const UI_DIR = path.join(ROOT, 'admin', 'ui');
const DATA_DIR = path.join(ROOT, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const ENV_FILE = path.join(ROOT, '.env');
const TRASH = path.join(ROOT, '.trash');

// ---------------------------------------------------------------- helpers ---
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const assertSlug = (s, what = 'slug') => { if (!SLUG_RE.test(s || '')) throw new HttpError(400, `Invalid ${what}`); return s; };

/** Resolve rel inside base; refuse anything that escapes it. */
function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) throw new HttpError(400, 'Path not allowed');
  return p;
}
const writeJSON = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
const listSlugs = () => (fs.existsSync(SITES_DIR) ? fs.readdirSync(SITES_DIR) : [])
  .filter(s => fs.existsSync(path.join(SITES_DIR, s, 'site.json')));
const listVerticals = () => fs.readdirSync(VERTICALS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 5e6) throw new HttpError(413, 'Body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Body must be JSON'); }
}

// ------------------------------------------------------- site diagnostics ---
/** Everything the launch checklist needs to know about one site. */
function siteStatus(slug) {
  const ctx = loadSite(slug);
  const { site, dir } = ctx;
  const pages = planPages(ctx);
  const review = fs.existsSync(path.join(dir, 'content', '_review.json')) ? readJSON(path.join(dir, 'content', '_review.json')) : {};
  let written = 0, reviewed = 0, ai = 0;
  for (const p of pages) {
    const c = readContent(dir, p.contentFile);
    if (!c) continue;
    written++;
    if (c.data.reviewed === 'true') reviewed++;
    if (c.data.source && c.data.source !== 'template') ai++;
  }
  const { _comment, ...cfg } = site;
  const todos = [...new Set(JSON.stringify(cfg).match(/TODO[^"]*/g) || [])];
  const distDir = path.join(ROOT, 'dist', slug);
  const built = fs.existsSync(path.join(distDir, 'index.html')) ? fs.statSync(path.join(distDir, 'index.html')).mtime.toISOString() : null;
  const citiesMissingNotes = site.cities.filter(c => !c.localNotes?.trim()).map(c => c.name);
  const checklist = [
    { id: 'todos', label: 'Business details filled in (no TODO values)', ok: todos.length === 0, detail: todos.join(' · ') },
    { id: 'buyers', label: 'Named buyer(s) for consent', ok: site.buyers?.length > 0 && !site.buyers.some(b => /TODO/.test(b.name)) },
    { id: 'author', label: 'Real content reviewer (E-E-A-T)', ok: !!site.author?.name && !/TODO/.test(site.author.name) },
    { id: 'notes', label: 'Local facts for every city', ok: citiesMissingNotes.length === 0, detail: citiesMissingNotes.length ? `Missing: ${citiesMissingNotes.join(', ')}` : '' },
    { id: 'content', label: 'Content written for every page', ok: written === pages.length, detail: `${written}/${pages.length}` },
    { id: 'reviewed', label: 'Every page human-reviewed', ok: reviewed === pages.length, detail: `${reviewed}/${pages.length}` },
    { id: 'flags', label: 'No compliance flags', ok: Object.keys(review).length === 0, detail: `${Object.keys(review).length} flagged` },
    { id: 'built', label: 'Built', ok: !!built, detail: built || '' }
  ];
  return {
    slug, brand: site.brand, domain: site.domain, vertical: site.vertical, cities: site.cities.length,
    pages: pages.length, written, reviewed, ai, flagged: Object.keys(review).length, built, todos, checklist,
    ready: checklist.every(c => c.ok)
  };
}

function sitePages(slug) {
  const ctx = loadSite(slug);
  const reviewFile = path.join(ctx.dir, 'content', '_review.json');
  const review = fs.existsSync(reviewFile) ? readJSON(reviewFile) : {};
  return planPages(ctx).map(p => {
    const c = readContent(ctx.dir, p.contentFile);
    return {
      url: p.url, kind: p.kind, file: p.contentFile, service: p.service?.name, city: p.city?.name,
      exists: !!c, reviewed: c?.data.reviewed === 'true', source: c?.data.source || null,
      title: c?.data.title || null, words: c ? c.body.split(/\s+/).filter(Boolean).length : 0,
      flags: review[p.contentFile] || []
    };
  });
}

function updateReviewFlags(dir, rel, body) {
  const f = path.join(dir, 'content', '_review.json');
  const review = fs.existsSync(f) ? readJSON(f) : {};
  const issues = lintBody(body);
  if (issues.length) review[rel] = issues; else delete review[rel];
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeJSON(f, review);
  return issues;
}

// ------------------------------------------------------------------ jobs ---
// Long tasks (generate, build, deploy, pull leads...) run as child processes
// of the same npm scripts you'd run by hand. Output is kept for the UI.
const jobs = new Map();
let jobSeq = 0;

const JOB_TYPES = {
  content:   { label: 'Generate content', needsSite: true, cmd: (o) => ['scripts/generate-content.mjs', '--site', o.site, ...(o.overwrite ? ['--overwrite'] : []), ...(o.template ? ['--template'] : []), ...(o.upgrade ? ['--upgrade'] : [])] },
  build:     { label: 'Build site', needsSite: true, cmd: (o) => ['scripts/build.mjs', '--site', o.site] },
  preview:   { label: 'Preview (dev server)', needsSite: true, long: true, cmd: (o) => ['scripts/build.mjs', '--site', o.site, '--dev'] },
  deploy:    { label: 'Deploy to Cloudflare', needsSite: true, cmd: (o) => ['scripts/deploy.mjs', '--site', o.site] },
  forge:     { label: 'Content + build', needsSite: true, cmd: (o) => ['scripts/forge.mjs', '--site', o.site, ...(o.template ? ['--template'] : [])] },
  leads:     { label: 'Pull leads', cmd: () => ['scripts/pull-leads.mjs'] },
  test:      { label: 'Run tests', cmd: () => ['--test', ...fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f))] },
  'cf-login':  { label: 'Log in to Cloudflare', cmd: () => [wranglerBin(), 'login'] },
  'cf-whoami': { label: 'Check Cloudflare login', cmd: () => [wranglerBin(), 'whoami'] },
  'd1-create': { label: 'Create lead database (D1)', cmd: () => [wranglerBin(), 'd1', 'create', 'apexforge-leads'], after: patchWranglerDbId },
  'd1-schema': { label: 'Apply database schema (remote)', cmd: () => [wranglerBin(), 'd1', 'execute', 'apexforge-leads', '--remote', '--file', 'db/schema.sql', '--yes'] }
};
function wranglerBin() { return path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'); }

/** After `wrangler d1 create`, copy the new database_id into wrangler.toml. */
function patchWranglerDbId(job) {
  const id = job.log.join('\n').match(/database_id\s*=\s*"?([0-9a-f-]{36})"?/i)?.[1]
    || job.log.join('\n').match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)?.[1];
  if (!id) return;
  const f = path.join(ROOT, 'wrangler.toml');
  const toml = fs.readFileSync(f, 'utf8').replace(/database_id = "[^"]*"/, `database_id = "${id}"`);
  fs.writeFileSync(f, toml);
  job.log.push(`✓ Saved database_id ${id} to wrangler.toml`);
}

function startJob(type, opts = {}) {
  const def = JOB_TYPES[type];
  if (!def) throw new HttpError(400, `Unknown job type "${type}"`);
  if (def.needsSite) { assertSlug(opts.site, 'site'); loadSite(opts.site); }
  for (const j of jobs.values()) {
    if (j.status === 'running' && j.type === type && j.site === opts.site) throw new HttpError(409, `${def.label} is already running for this site`);
    if (j.status === 'running' && def.long && j.long) throw new HttpError(409, 'A preview is already running. Stop it first.');
  }
  const id = String(++jobSeq);
  const job = { id, type, label: def.label, site: opts.site || null, status: 'running', started: new Date().toISOString(), ended: null, code: null, log: [], long: !!def.long };
  const child = spawn(process.execPath, def.cmd(opts), { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', ASTRO_TELEMETRY_DISABLED: '1' } });
  const push = (buf) => {
    for (const line of buf.toString().replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
      if (line.trim()) job.log.push(line);
    }
    if (job.log.length > 3000) job.log.splice(0, job.log.length - 3000);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('close', (code) => {
    job.code = code; job.ended = new Date().toISOString();
    job.status = job.status === 'stopped' ? 'stopped' : code === 0 ? 'done' : 'failed';
    if (job.status === 'done' && def.after) { try { def.after(job); } catch (e) { job.log.push('! ' + e.message); } }
  });
  child.on('error', (e) => { job.log.push('! ' + e.message); job.status = 'failed'; });
  job.child = child;
  jobs.set(id, job);
  return publicJob(job);
}
const publicJob = ({ child, ...j }) => ({ ...j, log: undefined, lines: j.log.length });

// ----------------------------------------------------------------- leads ---
const readLeadsDb = () => (fs.existsSync(LEADS_FILE) ? readJSON(LEADS_FILE) : { leads: {}, lastPull: {} });
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'sold', 'returned', 'dnc', 'bad'];

async function updateLead(id, patch) {
  const db = readLeadsDb();
  const lead = db.leads[id];
  if (!lead) throw new HttpError(404, 'Lead not found locally. Pull leads first.');
  const body = { id };
  for (const k of ['status', 'buyer', 'sold_price', 'notes']) if (k in patch) body[k] = patch[k];
  if (body.status && !LEAD_STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status');
  if ('sold_price' in body) body.sold_price = body.sold_price === '' || body.sold_price == null ? null : Number(body.sold_price);
  let synced = false, syncError = null;
  if (lead._api && process.env.ADMIN_TOKEN) {
    try {
      const r = await fetch(`${lead._api}/api/leads`, {
        method: 'PATCH', headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      synced = r.ok; if (!r.ok) syncError = `Site returned HTTP ${r.status}`;
    } catch (e) { syncError = e.message; }
  } else syncError = 'No ADMIN_TOKEN or source site; saved locally only.';
  Object.assign(lead, body, { updated_at: new Date().toISOString(), _unsynced: !synced });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJSON(LEADS_FILE, db);
  return { lead, synced, syncError };
}

// -------------------------------------------------------------- settings ---
// Editable .env keys. Secrets are never sent back to the browser in full.
const ENV_KEYS = [
  { key: 'OLLAMA_URL', group: 'AI', hint: 'Default http://localhost:11434' },
  { key: 'OLLAMA_MODEL', group: 'AI', hint: '3070 Ti (8 GB): llama3.1:8b, qwen2.5:7b, gemma2:9b' },
  { key: 'OLLAMA_DISABLED', group: 'AI', hint: 'Set 1 to skip Ollama' },
  { key: 'GROQ_API_KEY', group: 'AI', secret: true, hint: 'Free tier at console.groq.com' },
  { key: 'GROQ_MODEL', group: 'AI' },
  { key: 'GEMINI_API_KEY', group: 'AI', secret: true, hint: 'Free tier at aistudio.google.com' },
  { key: 'GEMINI_MODEL', group: 'AI' },
  { key: 'OPENROUTER_API_KEY', group: 'AI', secret: true, hint: 'Free models at openrouter.ai' },
  { key: 'OPENROUTER_MODEL', group: 'AI' },
  { key: 'ADMIN_TOKEN', group: 'Leads', secret: true, hint: 'Same value as ADMIN_TOKEN in Cloudflare. 24+ random characters.' },
  { key: 'LEAD_APIS', group: 'Leads', hint: 'Comma-separated site URLs to pull leads from' },
  { key: 'SETTLEMENT', group: 'Settlement', hint: 'none | log | koinos' },
  { key: 'KOINOS_RPC', group: 'Settlement' },
  { key: 'KOINOS_OPERATOR_WIF', group: 'Settlement', secret: true, hint: 'Private key. Keep secret.' },
  { key: 'KOINOS_REGISTRY_ID', group: 'Settlement' }
];
function readEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
function writeEnvFile(updates) {
  const current = readEnvFile();
  for (const [k, v] of Object.entries(updates)) {
    if (!ENV_KEYS.some(e => e.key === k)) continue;
    if (v === null) delete current[k]; else current[k] = String(v).replace(/[\r\n]/g, '');
    if (v === null) delete process.env[k]; else process.env[k] = current[k];
  }
  fs.writeFileSync(ENV_FILE, '# Managed by ApexForge Admin. Never commit this file.\n' +
    Object.entries(current).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
const mask = (v) => (v ? `${'•'.repeat(6)}${v.slice(-4)}` : '');

async function aiStatus() {
  const url = process.env.OLLAMA_URL || 'http://localhost:11434';
  let ollama = { reachable: false, models: [] };
  if (process.env.OLLAMA_DISABLED !== '1') {
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) ollama = { reachable: true, models: ((await r.json()).models || []).map(m => m.name) };
    } catch {}
  }
  return {
    ollama, model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    fallbacks: ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'].filter(k => process.env[k]).map(k => k.split('_')[0].toLowerCase())
  };
}

// ---------------------------------------------------------------- routes ---
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/overview', async () => {
  const sites = listSlugs().map(s => { try { return siteStatus(s); } catch (e) { return { slug: s, error: e.message }; } });
  const db = readLeadsDb();
  const leads = Object.values(db.leads);
  const count = (k) => leads.reduce((m, l) => ((m[l[k]] = (m[l[k]] || 0) + 1), m), {});
  return {
    sites, verticals: listVerticals(), ai: await aiStatus(),
    leads: {
      total: leads.length, byTier: count('tier'), byStatus: count('status'),
      revenue: leads.filter(l => l.status === 'sold').reduce((s, l) => s + Number(l.sold_price || 0), 0),
      lastPull: Object.values(db.lastPull || {}).sort().at(-1) || null
    },
    env: { hasEnv: fs.existsSync(ENV_FILE), adminToken: !!process.env.ADMIN_TOKEN, leadApis: !!process.env.LEAD_APIS },
    wranglerDbConfigured: !/0{8}-0{4}/.test(fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8'))
  };
});

// Verticals
route('GET', '/api/verticals', () => listVerticals().map(id => {
  const v = readJSON(path.join(VERTICALS_DIR, `${id}.json`));
  return { id, label: v.label, services: v.services.length, sites: listSlugs().filter(s => readJSON(path.join(SITES_DIR, s, 'site.json')).vertical === id).length };
}));
route('GET', '/api/verticals/:id', ({ id }) => {
  const f = safeJoin(VERTICALS_DIR, `${assertSlug(id, 'vertical')}.json`);
  if (!fs.existsSync(f)) throw new HttpError(404, 'Vertical not found');
  return readJSON(f);
});
route('PUT', '/api/verticals/:id', async ({ id }, req) => {
  const f = safeJoin(VERTICALS_DIR, `${assertSlug(id, 'vertical')}.json`);
  const v = await readBody(req);
  validateVertical(v);
  v.id = id;
  writeJSON(f, v);
  return { ok: true };
});
route('POST', '/api/verticals', async (_, req) => {
  const { id, label, copyFrom = 'life-insurance' } = await readBody(req);
  const newId = assertSlug(slugify(id || label || ''), 'vertical id');
  const f = safeJoin(VERTICALS_DIR, `${newId}.json`);
  if (fs.existsSync(f)) throw new HttpError(409, 'A vertical with that id exists');
  const base = readJSON(safeJoin(VERTICALS_DIR, `${assertSlug(copyFrom)}.json`));
  writeJSON(f, { ...base, id: newId, label: label || newId });
  return { ok: true, id: newId };
});
function validateVertical(v) {
  const need = ['label', 'heroTitle', 'heroSub', 'cta', 'audience', 'services', 'form', 'scoring', 'compliance'];
  const missing = need.filter(k => v[k] === undefined);
  if (missing.length) throw new HttpError(400, `Missing: ${missing.join(', ')}`);
  if (!Array.isArray(v.services) || !v.services.length) throw new HttpError(400, 'At least one service is required');
  for (const s of v.services) {
    if (!SLUG_RE.test(s.slug || '')) throw new HttpError(400, `Service "${s.name || '?'}" needs a lowercase-hyphen slug`);
    if (!s.name) throw new HttpError(400, 'Every service needs a name');
  }
  if (new Set(v.services.map(s => s.slug)).size !== v.services.length) throw new HttpError(400, 'Service slugs must be unique');
  if (!Array.isArray(v.form?.steps) || !v.form.steps.length) throw new HttpError(400, 'Form needs at least one step');
  const names = v.form.steps.flatMap(s => s.fields.map(f => f.name));
  for (const req of ['first_name', 'last_name', 'phone', 'email', 'zip']) {
    if (!names.includes(req)) throw new HttpError(400, `Form must include a "${req}" field (the lead API requires it)`);
  }
}

// Sites
route('GET', '/api/sites', () => listSlugs().map(s => { try { return siteStatus(s); } catch (e) { return { slug: s, error: e.message }; } }));
route('POST', '/api/sites', async (_, req) => {
  const b = await readBody(req);
  if (!b.brand) throw new HttpError(400, 'Brand name is required');
  if (!listVerticals().includes(b.vertical)) throw new HttpError(400, 'Pick a vertical');
  // Same slug rule as scripts/new-site.mjs, computed here so we can refuse duplicates.
  const slug = assertSlug(slugify(b.slug || b.domain?.replace(/\.[a-z]+$/, '') || b.brand));
  if (fs.existsSync(path.join(SITES_DIR, slug))) throw new HttpError(409, `A site named "${slug}" already exists`);
  const created = createSite({
    vertical: b.vertical, brand: b.brand, domain: b.domain || undefined, slug,
    state: b.state, 'state-name': b.stateName, cities: b.cities, email: b.email,
    'legal-name': b.legalName, address: b.address, buyer: b.buyer || [], author: b.author
  });
  return { ok: true, slug: created };
});
route('GET', '/api/sites/:slug', ({ slug }) => {
  const ctx = loadSite(assertSlug(slug));
  return { site: ctx.site, status: siteStatus(slug) };
});
route('PUT', '/api/sites/:slug', async ({ slug }, req) => {
  assertSlug(slug);
  const site = await readBody(req);
  if (!site.brand || !Array.isArray(site.cities) || !site.cities.length) throw new HttpError(400, 'Brand and at least one city are required');
  if (!listVerticals().includes(site.vertical)) throw new HttpError(400, 'Unknown vertical');
  for (const c of site.cities) {
    if (!c.name) throw new HttpError(400, 'Every city needs a name');
    c.slug = c.slug ? slugify(c.slug) : slugify(`${c.name}-${site.state || ''}`);
  }
  if (new Set(site.cities.map(c => c.slug)).size !== site.cities.length) throw new HttpError(400, 'Two cities have the same slug');
  site.slug = slug; // slug is the folder name; renaming is not supported (it is also the Cloudflare project name)
  writeJSON(path.join(SITES_DIR, slug, 'site.json'), site);
  return { ok: true, status: siteStatus(slug) };
});
route('DELETE', '/api/sites/:slug', ({ slug }) => {
  const dir = safeJoin(SITES_DIR, assertSlug(slug));
  if (!fs.existsSync(dir)) throw new HttpError(404, 'Not found');
  fs.mkdirSync(TRASH, { recursive: true });
  const dest = path.join(TRASH, `${slug}-${Date.now()}`);
  fs.renameSync(dir, dest);
  return { ok: true, movedTo: path.relative(ROOT, dest) };
});

// Content
route('GET', '/api/sites/:slug/pages', ({ slug }) => sitePages(assertSlug(slug)));
route('GET', '/api/sites/:slug/content', ({ slug }, req, url) => {
  const ctx = loadSite(assertSlug(slug));
  const rel = url.searchParams.get('file');
  if (!planPages(ctx).some(p => p.contentFile === rel)) throw new HttpError(400, 'Not a page of this site');
  const c = readContent(ctx.dir, rel);
  return { file: rel, data: c?.data || {}, body: c?.body || '', exists: !!c, flags: c ? lintBody(c.body) : [] };
});
route('PUT', '/api/sites/:slug/content', async ({ slug }, req, url) => {
  const ctx = loadSite(assertSlug(slug));
  const rel = url.searchParams.get('file');
  if (!planPages(ctx).some(p => p.contentFile === rel)) throw new HttpError(400, 'Not a page of this site');
  const { data = {}, body = '' } = await readBody(req);
  const clean = {
    title: data.title || '', description: data.description || '', h1: data.h1 || '',
    source: data.source || 'manual', reviewed: data.reviewed === 'true' || data.reviewed === true ? 'true' : 'false'
  };
  writeContent(ctx.dir, rel, clean, body);
  return { ok: true, flags: updateReviewFlags(ctx.dir, rel, body) };
});
route('POST', '/api/sites/:slug/review-all', async ({ slug }, req) => {
  const ctx = loadSite(assertSlug(slug));
  const { reviewed = true } = await readBody(req);
  let n = 0;
  for (const p of planPages(ctx)) {
    const c = readContent(ctx.dir, p.contentFile);
    if (!c) continue;
    writeContent(ctx.dir, p.contentFile, { ...c.data, reviewed: reviewed ? 'true' : 'false' }, c.body);
    n++;
  }
  return { ok: true, updated: n };
});

// Jobs
route('GET', '/api/jobs', () => [...jobs.values()].reverse().map(publicJob));
route('POST', '/api/jobs', async (_, req) => { const b = await readBody(req); return startJob(b.type, b); });
route('GET', '/api/jobs/:id', ({ id }, req, url) => {
  const j = jobs.get(id);
  if (!j) throw new HttpError(404, 'No such job');
  const from = Number(url.searchParams.get('from') || 0);
  return { ...publicJob(j), log: j.log.slice(from), from };
});
route('POST', '/api/jobs/:id/stop', ({ id }) => {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') throw new HttpError(400, 'Job is not running');
  j.status = 'stopped'; j.child.kill();
  return { ok: true };
});

// Leads
route('GET', '/api/leads', () => {
  const db = readLeadsDb();
  return { lastPull: db.lastPull || {}, leads: Object.values(db.leads).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
});
route('PATCH', '/api/leads/:id', async ({ id }, req) => updateLead(id, await readBody(req)));

// Guides: repo docs shown inside the admin (allowlisted files only).
const DOCS = {
  'setup-windows': { title: 'Windows setup, step by step', file: 'docs/SETUP-WINDOWS.md' },
  'call-scripts': { title: 'Call scripts', file: 'docs/CALL-SCRIPTS.md' },
  'next-steps': { title: 'Next steps checklist', file: 'docs/NEXT-STEPS.md' },
  plan: { title: 'Business plan & architecture', file: 'docs/PLAN.md' }
};
route('GET', '/api/docs', () => Object.entries(DOCS).map(([id, d]) => ({ id, title: d.title, exists: fs.existsSync(path.join(ROOT, d.file)) })));
route('GET', '/api/docs/:id', ({ id }) => {
  const d = DOCS[id];
  if (!d) throw new HttpError(404, 'No such guide');
  return { id, title: d.title, markdown: fs.readFileSync(path.join(ROOT, d.file), 'utf8') };
});

// Settings
route('GET', '/api/settings', async () => {
  const env = readEnvFile();
  return {
    keys: ENV_KEYS.map(e => ({ ...e, set: !!env[e.key], value: e.secret ? mask(env[e.key]) : (env[e.key] || '') })),
    ai: await aiStatus(),
    wranglerToml: fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8')
  };
});
route('PUT', '/api/settings', async (_, req) => { writeEnvFile(await readBody(req)); return { ok: true }; });
route('POST', '/api/settings/generate-token', () => ({ token: crypto.randomBytes(24).toString('base64url') }));

// ---------------------------------------------------------------- server ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer'
    });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    const host = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host)) return send(403, { error: 'Forbidden host' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-admin-token'] !== TOKEN) return send(401, { error: 'Reload the admin page (session expired).' });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        return send(200, await r.fn(params, req, url));
      }
      return send(404, { error: 'No such endpoint' });
    }

    // Static UI. index.html gets the session token injected.
    if (url.pathname === '/vendor/marked.js') {
      return send(200, fs.readFileSync(path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js')), MIME['.js']);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = safeJoin(UI_DIR, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'Not found', 'text/plain');
    let body = fs.readFileSync(file);
    if (rel === 'index.html') body = body.toString().replace('__ADMIN_TOKEN__', TOKEN);
    send(200, body, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    const status = e.status || (/not found/i.test(e.message) ? 404 : 500);
    if (status === 500) console.error(e);
    send(status, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ApexForge Admin → http://127.0.0.1:${PORT}\n  (local only · Ctrl+C to stop)\n`);
});
process.on('SIGINT', () => { for (const j of jobs.values()) j.child?.kill(); process.exit(0); });
