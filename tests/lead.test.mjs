// tests/lead.test.mjs — run with `npm test`. Uses real SQLite via tests/helpers/d1.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLead, handleListLeads, handleUpdateLead, toCSV } from '../lib/lead-handler.mjs';
import { scoreLead, normalizeUSPhone, ageFromDob } from '../lib/scoring.mjs';
import { makeD1 } from './helpers/d1.mjs';
import fs from 'node:fs';

const vertical = JSON.parse(fs.readFileSync(new URL('../verticals/life-insurance.json', import.meta.url)));
const registry = {
  sites: { demo: { vertical: 'life-insurance', brand: 'Demo Life', buyers: ['Demo Agency LLC'], partners: [] } },
  verticals: { 'life-insurance': { scoring: vertical.scoring, labels: {}, services: {} } },
  partners: {}
};
const rows = (env) => env.DB.raw.prepare('SELECT * FROM leads ORDER BY rowid').all();

export const goodLead = {
  site: 'demo', service: 'term-life-insurance', coverage_amount: '$250,000 - $500,000', monthly_budget: '$30 - $50',
  dob: '1985-04-02', sex: 'Female', height_ft: '5', height_in: '6', weight: '150', tobacco: 'Never',
  conditions: ['None of these'], first_name: 'Jane', last_name: 'Doe', zip: '29577', phone: '(843) 555-2368',
  email: 'jane@example.com', best_time: 'Weekday evenings', consent: 'yes', consent_text: 'I consent to Demo Agency LLC...', _time_on_page_s: 45
};
export const req = (body, ip = '1.2.3.4') => new Request('https://x.test/api/lead', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body)
});

test('age from date of birth', () => {
  assert.equal(ageFromDob('1985-04-02', new Date('2026-04-01T12:00:00Z')), 40);
  assert.equal(ageFromDob('1985-04-02', new Date('2026-04-02T12:00:00Z')), 41);
  assert.equal(ageFromDob('not a date'), null);
});

test('phone normalization', () => {
  assert.equal(normalizeUSPhone('(843) 555-2368'), '+18435552368');
  assert.equal(normalizeUSPhone('1-843-555-2368'), '+18435552368');
  assert.equal(normalizeUSPhone('555-0100'), null);
  assert.equal(normalizeUSPhone('1111111111'), null);
  assert.equal(normalizeUSPhone('0435552368'), null);
});

test('scoring gives a strong term lead tier A', () => {
  const r = scoreLead(goodLead, vertical.scoring);
  assert.equal(r.tier, 'A');
  assert.ok(r.score >= 70, `score ${r.score}`);
});

test('valid lead is stored with consent proof and stays with the operator when no partners', async () => {
  const env = { DB: makeD1() };
  const res = await handleLead(req(goodLead), env, registry);
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.ok(out.ok && out.id);
  assert.equal(out.contact.name, 'Demo Agency LLC');
  const [row] = rows(env);
  assert.equal(row.phone, '+18435552368');
  assert.equal(row.tier, 'A');
  assert.equal(row.status, 'new');
  assert.equal(row.partner_id, null);
  assert.equal(row.consent_hash.length, 64);
  assert.equal(row.ip, '1.2.3.4');
  assert.equal(row.bot_check, 'not_configured');
  assert.equal(JSON.parse(row.answers_json).coverage_amount, '$250,000 - $500,000');
});

test('minors are rejected; SSN/card numbers typed in free text are removed; arrays stored', async () => {
  const env = { DB: makeD1() };
  assert.equal((await handleLead(req({ ...goodLead, dob: '2012-01-01' }), env, registry)).status, 422);
  await handleLead(req({ ...goodLead, medications: 'metformin, my ssn is 123-45-6789 card 4111 1111 1111 1111',
    conditions: ['High blood pressure', 'Sleep apnea'] }), env, registry);
  const a = JSON.parse(rows(env)[0].answers_json);
  assert.doesNotMatch(a.medications, /6789|1111/);
  assert.match(a.medications, /metformin/);
  assert.deepEqual(a.conditions, ['High blood pressure', 'Sleep apnea']);
});

test('missing consent is rejected', async () => {
  assert.equal((await handleLead(req({ ...goodLead, consent: undefined }), { DB: makeD1() }, registry)).status, 422);
});

test('honeypot silently drops bots', async () => {
  const env = { DB: makeD1() };
  const res = await handleLead(req({ ...goodLead, company_website: 'spam.biz' }), env, registry);
  assert.equal(res.status, 200);
  assert.equal(rows(env).length, 0);
});

test('unknown site rejected, duplicate flagged', async () => {
  const env = { DB: makeD1() };
  assert.equal((await handleLead(req({ ...goodLead, site: 'nope' }), env, registry)).status, 400);
  await handleLead(req(goodLead, '9.9.9.1'), env, registry);
  await handleLead(req(goodLead, '9.9.9.2'), env, registry);
  const [first, second] = rows(env);
  assert.equal(second.status, 'bad');
  assert.equal(second.duplicate_of, first.id);
});

test('rate limit after 5 per IP', async () => {
  const env = { DB: makeD1() };
  for (let i = 0; i < 5; i++) await handleLead(req({ ...goodLead, phone: `843555${2300 + i}` }), env, registry);
  assert.equal((await handleLead(req({ ...goodLead, phone: '8435552399' }), env, registry)).status, 429);
});

test('admin API requires token; update + CSV work', async () => {
  const env = { DB: makeD1(), ADMIN_TOKEN: 'x'.repeat(32) };
  await handleLead(req(goodLead), env, registry);
  const id = rows(env)[0].id;
  assert.equal((await handleListLeads(new Request('https://x.test/api/leads'), env)).status, 401);
  const auth = { authorization: `Bearer ${'x'.repeat(32)}` };
  const list = await (await handleListLeads(new Request('https://x.test/api/leads', { headers: auth }), env)).json();
  assert.equal(list.count, 1);
  const up = await handleUpdateLead(new Request('https://x.test/api/leads', {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id, status: 'sold', buyer: 'Demo Agency', sold_price: 60 })
  }), env);
  assert.equal(up.status, 200);
  assert.equal(rows(env)[0].status, 'sold');
  assert.match(toCSV([{ a: '=HYPERLINK("x")', b: '+18435552368' }]), /'=HYPERLINK/);
});
