// tests/routing.test.mjs — automatic routing, prepaid balances, delivery, partner portal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLead, handlePartner, handlePartnerCredits, handleUpdateLead } from '../lib/lead-handler.mjs';
import { choosePartner, priceFor, partnersForPage } from '../lib/routing.mjs';
import { sha256Hex } from '../lib/scoring.mjs';
import { makeD1 } from './helpers/d1.mjs';
import fs from 'node:fs';

const re = JSON.parse(fs.readFileSync(new URL('../verticals/real-estate.json', import.meta.url)));
const TOKEN_JANE = 'jane-portal-token-0123456789';
const ADMIN = 'a'.repeat(32);

async function makeRegistry() {
  return {
    sites: {
      homes: {
        vertical: 'real-estate', brand: 'Grand Strand Home Value', domain: 'example-homes.com', buyers: ['CPP Holdings LLC'],
        operator: { name: 'CPP Holdings LLC', address: '1 Main St' }, bookingUrl: '',
        partners: [
          { id: 'jane', cities: ['conway-sc', 'aynor-sc'] },
          { id: 'bob', cities: [], minTier: 'A' }
        ]
      }
    },
    verticals: { 'real-estate': { scoring: re.scoring, labels: { timeline: 'Timeline' }, services: { 'sell-my-house': 'Sell My House' } } },
    partners: {
      jane: { name: 'Jane Smith', company: 'ABC Realty', consentName: 'Jane Smith of ABC Realty', email: 'jane@example.com', phone: '843-555-0100',
        bookingUrl: 'https://cal.com/jane', pricePerLead: 60, priceByTier: { A: 80 }, weeklyCap: 2, minTier: 'B', prepaid: true, active: true,
        tokenHash: await sha256Hex(TOKEN_JANE) },
      bob: { name: 'Bob Lee', company: 'Coastal Homes', consentName: 'Bob Lee of Coastal Homes', email: 'bob@example.com',
        pricePerLead: 50, weeklyCap: 0, minTier: 'A', prepaid: false, active: true, tokenHash: '' }
    }
  };
}

const CONSENT_ALL = 'I give consent for CPP Holdings LLC, Jane Smith of ABC Realty and Bob Lee of Coastal Homes to contact me';
const seller = (o = {}) => ({
  site: 'homes', service: 'sell-my-house', timeline: 'ASAP', price_range: '$350,000 - $500,000', address: '100 Example Ln',
  listed: 'No', first_name: 'Linda', last_name: 'Test', zip: '29526', city: 'Conway', city_slug: 'conway-sc',
  phone: '(843) 555-2368', email: 'linda@example.com', consent: 'yes', consent_text: CONSENT_ALL, _time_on_page_s: 90, ...o
});
let ipN = 0;
const req = (body) => new Request('https://x.test/api/lead', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${++ipN}` }, body: JSON.stringify(body)
});
const leads = (env) => env.DB.raw.prepare('SELECT * FROM leads ORDER BY rowid').all();
const credit = (env, partner_id, amount) => handlePartnerCredits(new Request('https://x.test/api/partner-credits', {
  method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ partner_id, amount, note: 'test' })
}), env, globalThis.__reg);

function captureFetch() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null }); return new Response('{"id":"x","success":true}', { status: 200 }); };
  return { calls, restore: () => (globalThis.fetch = orig) };
}

test('pure routing rules', () => {
  const partners = { p: { name: 'P', consentName: 'P of Co', active: true, minTier: 'B', weeklyCap: 1, prepaid: true, pricePerLead: 40 } };
  const lead = { tier: 'A', service: 'x', citySlug: 'conway-sc', consentText: 'for P of Co to contact' };
  assert.equal(choosePartner({ lead, assignments: [{ id: 'p' }], partners, stats: { p: { balance: 100 } } }).partner.id, 'p');
  assert.equal(choosePartner({ lead, assignments: [{ id: 'p' }], partners, stats: { p: { balance: 10 } } }).considered[0].reason, 'balance too low');
  assert.equal(choosePartner({ lead, assignments: [{ id: 'p' }], partners, stats: { p: { balance: 99, weekCount: 1 } } }).considered[0].reason, 'weekly cap reached');
  assert.equal(choosePartner({ lead: { ...lead, tier: 'C' }, assignments: [{ id: 'p' }], partners, stats: { p: { balance: 99 } } }).considered[0].reason, 'below tier B');
  assert.equal(choosePartner({ lead: { ...lead, consentText: 'someone else' }, assignments: [{ id: 'p' }], partners, stats: { p: { balance: 99 } } }).considered[0].reason, 'not named in consent');
  assert.equal(choosePartner({ lead, assignments: [{ id: 'p', cities: ['aynor-sc'] }], partners, stats: { p: { balance: 99 } } }).considered[0].reason, 'outside service area');
  assert.equal(priceFor({ pricePerLead: 60, priceByTier: { A: 80, B: 0 } }, 'A'), 80);
  assert.equal(priceFor({ pricePerLead: 60, priceByTier: { A: 80, B: 0 } }, 'B'), 60); // 0 = use flat price
  assert.deepEqual(partnersForPage({ assignments: [{ id: 'p', cities: ['aynor-sc'] }], partners, citySlug: 'conway-sc' }), []);
});

test('lead routes to Jane, delivers instantly, deducts balance; cap and fallback work', async () => {
  const reg = (globalThis.__reg = await makeRegistry());
  const env = { DB: makeD1(), ADMIN_TOKEN: ADMIN, RESEND_API_KEY: 're_test', EMAIL_FROM: 'Homes <hi@example-homes.com>', NOTIFY_WEBHOOK: 'https://hooks.example/x' };
  const f = captureFetch();
  try {
    // No balance yet → Jane is skipped; lead is tier A so Bob (not prepaid) gets it.
    let waits = [];
    let out = await (await handleLead(req(seller()), env, reg, { waitUntil: (p) => waits.push(p) })).json();
    await Promise.all(waits);
    assert.equal(out.contact.name, 'Bob Lee');
    assert.equal(leads(env)[0].partner_id, 'bob');

    // Pay Jane $160 → she gets the next two Conway leads (round robin favors the partner who waited longest).
    await credit(env, 'jane', 160);
    waits = [];
    out = await (await handleLead(req(seller({ phone: '843-555-2370', email: 'b@example.com' })), env, reg, { waitUntil: (p) => waits.push(p) })).json();
    await Promise.all(waits);
    assert.equal(out.contact.name, 'Jane Smith');
    assert.equal(out.contact.bookingUrl, 'https://cal.com/jane');
    const row = leads(env)[1];
    assert.equal(row.partner_id, 'jane');
    assert.equal(row.status, 'sold');
    assert.equal(row.sold_price, 80); // tier A price
    const emails = f.calls.filter(c => c.url.includes('resend.com'));
    assert.ok(emails.some(e => e.body.to[0] === 'jane@example.com' && /Linda/.test(e.body.subject)), 'partner emailed');
    assert.ok(emails.some(e => e.body.to[0] === 'b@example.com' && /Jane Smith of ABC Realty/.test(e.body.html)), 'consumer told who will call');
    assert.ok(f.calls.some(c => c.url === 'https://hooks.example/x' && /Jane Smith of ABC Realty/.test(c.body.content)), 'operator alerted');

    // Balances: Jane 160 - 80 = 80.
    const bal = await (await handlePartnerCredits(new Request('https://x.test/api/partner-credits', { headers: { authorization: `Bearer ${ADMIN}` } }), env, reg)).json();
    assert.equal(bal.partners.jane.balance, 80);

    // A lead outside Jane's cities and below Bob's tier stays with the operator.
    out = await (await handleLead(req(seller({ phone: '843-555-2371', email: 'c@example.com', city_slug: 'loris-sc', timeline: '6-12 months' })), env, reg)).json();
    assert.equal(out.contact.name, 'CPP Holdings LLC');
    assert.equal(leads(env)[2].status, 'new');
    assert.match(leads(env)[2].route_log, /outside service area/);

    // A page whose consent only named CPP can never be routed to a partner.
    await handleLead(req(seller({ phone: '843-555-2372', email: 'd@example.com', consent_text: 'consent for CPP Holdings LLC only' })), env, reg);
    assert.equal(leads(env)[3].partner_id, null);
  } finally { f.restore(); }
});

test('partner portal: sees only own leads, can request a return, operator approval refunds balance', async () => {
  const reg = (globalThis.__reg = await makeRegistry());
  const env = { DB: makeD1(), ADMIN_TOKEN: ADMIN };
  const f = captureFetch();
  try {
    await credit(env, 'jane', 200);
    await handleLead(req(seller()), env, reg);                                  // → jane
    await handleLead(req(seller({ phone: '843-555-2380', email: 'z@example.com', city_slug: 'loris-sc' })), env, reg); // → bob
    const auth = { authorization: `Bearer ${TOKEN_JANE}` };
    assert.equal((await handlePartner(new Request('https://x.test/api/partner', { headers: { authorization: 'Bearer wrong-token-000000000' } }), env, reg)).status, 401);
    const mine = await (await handlePartner(new Request('https://x.test/api/partner', { headers: auth }), env, reg)).json();
    assert.equal(mine.leads.length, 1);
    assert.equal(mine.partner.balance, 120);
    const id = mine.leads[0].id;
    const ret = await handlePartner(new Request('https://x.test/api/partner', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'return', id, reason: 'Wrong number' }) }), env, reg);
    assert.equal(ret.status, 200);
    assert.equal(leads(env)[0].status, 'return_requested');
    const again = await handlePartner(new Request('https://x.test/api/partner', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'return', id, reason: 'x' }) }), env, reg);
    assert.equal(again.status, 409);
    // Operator approves → status returned → balance restored.
    await handleUpdateLead(new Request('https://x.test/api/leads', { method: 'PATCH', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, status: 'returned' }) }), env);
    const after = await (await handlePartner(new Request('https://x.test/api/partner', { headers: auth }), env, reg)).json();
    assert.equal(after.partner.balance, 200);
  } finally { f.restore(); }
});

test('Turnstile: blocks failed checks, accepts passed ones', async () => {
  const reg = await makeRegistry();
  const env = { DB: makeD1(), TURNSTILE_SECRET: 'secret' };
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false }));
    assert.equal((await handleLead(req(seller({ 'cf-turnstile-response': 'bad' })), env, reg)).status, 403);
    globalThis.fetch = async (u) => new Response(JSON.stringify({ success: String(u).includes('turnstile') }));
    assert.equal((await handleLead(req(seller({ 'cf-turnstile-response': 'good' })), env, reg)).status, 200);
    assert.equal(leads(env)[0].bot_check, 'passed');
  } finally { globalThis.fetch = orig; }
});
