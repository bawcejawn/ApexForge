#!/usr/bin/env node
// scripts/pull-leads.mjs
// -----------------------------------------------------------------------------
// Operator CRM, the zero-cost version: pull leads from every deployed site into
// data/leads.json + data/leads.csv (open in Excel/Google Sheets).
//
//   npm run leads                         # pull new leads from all sites in .env
//   npm run leads -- --set <id> --status sold --buyer "Coastal Life" --price 60
//
// .env:  ADMIN_TOKEN=...   LEAD_APIS=https://site-a.pages.dev,https://site-b.com
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from '../lib/core.mjs';
import { toCSV } from '../lib/lead-handler.mjs';
import { loadEnv } from './env.mjs';

loadEnv();
const a = parseArgs();
const token = process.env.ADMIN_TOKEN;
const apis = String(process.env.LEAD_APIS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
if (!token || !apis.length) {
  console.error('✗ Set ADMIN_TOKEN and LEAD_APIS in .env (see .env.example).');
  process.exit(1);
}
const auth = { authorization: `Bearer ${token}` };
const DATA = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA, 'leads.json');
fs.mkdirSync(DATA, { recursive: true });
const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : { leads: {}, lastPull: {} };

if (a.set) {
  // CRM update -> push to the site that owns the lead.
  const lead = db.leads[a.set];
  const api = lead?._api || apis[0];
  const body = { id: a.set };
  if (a.status) body.status = a.status;
  if (a.buyer) body.buyer = a.buyer;
  if (a.price) body.sold_price = Number(a.price);
  if (a.notes) body.notes = a.notes;
  const r = await fetch(`${api}/api/leads`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.ok ? `✓ Updated ${a.set}` : `✗ ${r.status} ${await r.text()}`);
  if (r.ok && lead) Object.assign(lead, body, { sold_price: body.sold_price ?? lead.sold_price });
} else {
  for (const api of apis) {
    const since = db.lastPull[api] || '1970-01-01';
    const r = await fetch(`${api}/api/leads?since=${encodeURIComponent(since)}`, { headers: auth });
    if (!r.ok) { console.error(`✗ ${api}: HTTP ${r.status}`); continue; }
    const { leads = [], serverTime } = await r.json();
    for (const l of leads) db.leads[l.id] = { ...db.leads[l.id], ...l, _api: api, _unsynced: false };
    // Use the server's clock so status changes (e.g. partner return requests) are picked up next time too.
    db.lastPull[api] = serverTime || leads[0]?.created_at || since;
    console.log(`✓ ${api}: ${leads.length} new`);
  }
}

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const rows = Object.values(db.leads).sort((x, y) => y.created_at.localeCompare(x.created_at))
  .map(({ _api, answers_json, consent_text, user_agent, ...rest }) => ({ ...rest, answers: answers_json }));
fs.writeFileSync(path.join(DATA, 'leads.csv'), toCSV(rows));

// Quick pipeline summary
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
const revenue = rows.filter(r => r.status === 'sold').reduce((s, r) => s + Number(r.sold_price || 0), 0);
console.log(`\n${rows.length} leads total · by tier ${JSON.stringify(by('tier'))} · by status ${JSON.stringify(by('status'))} · sold revenue $${revenue}`);
console.log('→ data/leads.csv');
