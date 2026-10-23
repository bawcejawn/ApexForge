// tests/lead.test.mjs — run with `npm test`. Uses an in-memory fake of D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLead, handleListLeads, handleUpdateLead, toCSV } from '../lib/lead-handler.mjs';
import { scoreLead, normalizeUSPhone } from '../lib/scoring.mjs';
import fs from 'node:fs';

const vertical = JSON.parse(fs.readFileSync(new URL('../verticals/life-insurance.json', import.meta.url)));
const registry = {
  sites: { demo: { vertical: 'life-insurance', brand: 'Demo Life', buyers: ['Demo Agency LLC'] } },
  verticals: { 'life-insurance': { scoring: vertical.scoring } }
};

/** Minimal fake of the D1 API surface we use. */
function fakeDB() {
  const rows = [];
  const cols = ['id', 'created_at', 'site', 'vertical', 'service', 'first_name', 'last_name', 'email', 'phone', 'zip', 'city',
    'answers_json', 'score', 'tier', 'suggested_price', 'duplicate_of', 'status', 'consent_text', 'consent_hash', 'consent_at',
    'ip', 'user_agent', 'page_url', 'referrer', 'utm_json', 'time_on_page_s', 'lead_hash'];
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.includes('COUNT(*)')) return { n: rows.filter(r => r.ip === args[0] && r.created_at > args[1]).length };
          if (sql.includes('WHERE phone')) return rows.find(r => r.phone === args[0] && r.site === args[1]) || null;
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT')) rows.push(Object.fromEntries(cols.map((c, i) => [c, args[i]])));
          if (sql.startsWith('UPDATE')) {
            const id = args.at(-1);
            const keys = sql.match(/SET (.*), updated_at/)[1].split(', ').map(s => s.split(' ')[0]);
            Object.assign(rows.find(r => r.id === id), Object.fromEntries(keys.map((k, i) => [k, args[i]])));
          }
          return { success: true };
        },
        async all() { return { results: [...rows].reverse() }; }
      };
      return stmt;
    }
  };
}

const goodLead = {
  site: 'demo', service: 'term-life-insurance', coverage_amount: '$250,000 - $500,000', monthly_budget: '$30 - $50',
  dob: '1985-04-02', sex: 'Female', height_ft: '5', height_in: '6', weight: '150', tobacco: 'Never',
  conditions: ['None of these'], first_name: 'Jane', last_name: 'Doe', zip: '78701', phone: '(512) 555-2368',
  email: 'jane@example.com', best_time: 'Weekday evenings', consent: 'yes', consent_text: 'I consent...', _time_on_page_s: 45
};

test('age from date of birth', async () => {
  const { ageFromDob } = await import('../lib/scoring.mjs');
  assert.equal(ageFromDob('1985-04-02', new Date('2026-04-01T12:00:00Z')), 40);
  assert.equal(ageFromDob('1985-04-02', new Date('2026-04-02T12:00:00Z')), 41);
  assert.equal(ageFromDob('not a date'), null);
});

test('minors are rejected; SSN/card numbers typed in free text are removed; arrays stored', async () => {
  const env = { DB: fakeDB() };
  const kid = await handleLead(req({ ...goodLead, dob: '2012-01-01' }), env, registry);
  assert.equal(kid.status, 422);
  await handleLead(req({ ...goodLead, medications: 'metformin, my ssn is 123-45-6789 card 4111 1111 1111 1111',
    conditions: ['High blood pressure', 'Sleep apnea'] }), env, registry);
  const a = JSON.parse(env.DB.rows[0].answers_json);
  assert.doesNotMatch(a.medications, /6789|1111/);
  assert.match(a.medications, /metformin/);
  assert.deepEqual(a.conditions, ['High blood pressure', 'Sleep apnea']);
});
const req = (body, ip = '1.2.3.4') => new Request('https://x.test/api/lead', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body)
});

test('phone normalization', () => {
  assert.equal(normalizeUSPhone('(512) 555-2368'), '+15125552368');
  assert.equal(normalizeUSPhone('1-512-555-2368'), '+15125552368');
  assert.equal(normalizeUSPhone('555-0100'), null);
  assert.equal(normalizeUSPhone('1111111111'), null);
  assert.equal(normalizeUSPhone('0435552368'), null);
});

test('scoring gives a strong term lead tier A', () => {
  const r = scoreLead(goodLead, vertical.scoring);
  assert.equal(r.tier, 'A');
  assert.ok(r.score >= 70, `score ${r.score}`);
});

test('valid lead is stored with consent proof', async () => {
  const env = { DB: fakeDB() };
  const res = await handleLead(req(goodLead), env, registry);
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.ok(out.ok && out.id);
  const row = env.DB.rows[0];
  assert.equal(row.phone, '+15125552368');
  assert.equal(row.tier, 'A');
  assert.equal(row.consent_hash.length, 64);
  assert.equal(row.ip, '1.2.3.4');
  assert.equal(JSON.parse(row.answers_json).coverage_amount, '$250,000 - $500,000');
});

test('missing consent is rejected', async () => {
  const res = await handleLead(req({ ...goodLead, consent: undefined }), { DB: fakeDB() }, registry);
  assert.equal(res.status, 422);
});

test('honeypot silently drops bots', async () => {
  const env = { DB: fakeDB() };
  const res = await handleLead(req({ ...goodLead, company_website: 'spam.biz' }), env, registry);
  assert.equal(res.status, 200);
  assert.equal(env.DB.rows.length, 0);
});

test('unknown site rejected, duplicate flagged', async () => {
  const env = { DB: fakeDB() };
  assert.equal((await handleLead(req({ ...goodLead, site: 'nope' }), env, registry)).status, 400);
  await handleLead(req(goodLead, '9.9.9.1'), env, registry);
  await handleLead(req(goodLead, '9.9.9.2'), env, registry);
  assert.equal(env.DB.rows[1].status, 'bad');
  assert.equal(env.DB.rows[1].duplicate_of, env.DB.rows[0].id);
});

test('rate limit after 5 per IP', async () => {
  const env = { DB: fakeDB() };
  for (let i = 0; i < 5; i++) await handleLead(req({ ...goodLead, phone: `512555${2300 + i}` }), env, registry);
  const res = await handleLead(req({ ...goodLead, phone: '5125552399' }), env, registry);
  assert.equal(res.status, 429);
});

test('admin API requires token; update + CSV work', async () => {
  const env = { DB: fakeDB(), ADMIN_TOKEN: 'x'.repeat(32) };
  await handleLead(req(goodLead), env, registry);
  const id = env.DB.rows[0].id;
  assert.equal((await handleListLeads(new Request('https://x.test/api/leads'), env)).status, 401);
  const auth = { authorization: `Bearer ${'x'.repeat(32)}` };
  const list = await (await handleListLeads(new Request('https://x.test/api/leads', { headers: auth }), env)).json();
  assert.equal(list.count, 1);
  const up = await handleUpdateLead(new Request('https://x.test/api/leads', {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id, status: 'sold', buyer: 'Demo Agency', sold_price: 60 })
  }), env);
  assert.equal(up.status, 200);
  assert.equal(env.DB.rows[0].status, 'sold');
  assert.match(toCSV([{ a: '=HYPERLINK("x")', b: '+15125552368' }]), /'=HYPERLINK/);
});
