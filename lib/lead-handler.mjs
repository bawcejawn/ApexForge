// lib/lead-handler.mjs
// -----------------------------------------------------------------------------
// Runtime logic for the lead API, written as plain functions so it can be unit
// tested in Node (tests/*.test.mjs) and wrapped by Cloudflare Pages Functions
// (functions/api/*.js). No Node-only imports allowed here.
//
// What happens when a lead is submitted (handleLead):
//   1. Bot checks: honeypot, time on page, optional Cloudflare Turnstile
//   2. Validation: phone, email, ZIP, name, consent, age 18+
//   3. Rate limit + duplicate check
//   4. Score and tier (lib/scoring.mjs)
//   5. Route to a partner (lib/routing.mjs), or keep for the operator
//   6. Save everything, including consent proof and why it was routed
//   7. Deliver instantly: partner email + webhook, consumer confirmation,
//      operator alert (lib/notify.mjs)
//
// Cloudflare settings (Pages project → Settings):
//   DB                 D1 database binding (required)
//   ADMIN_TOKEN        secret for admin endpoints (required for the admin app)
//   NOTIFY_WEBHOOK     your Discord/Slack webhook for alerts (optional)
//   NOTIFY_INCLUDE_PII "1" to include phone/name in your alerts (optional)
//   TURNSTILE_SECRET   Cloudflare Turnstile secret key (optional, free)
//   RESEND_API_KEY, EMAIL_FROM, OPERATOR_EMAIL   email delivery (optional, free)
// -----------------------------------------------------------------------------
import { scoreLead, normalizeUSPhone, isValidEmail, sha256Hex, ageFromDob } from './scoring.mjs';
import { choosePartner } from './routing.mjs';
import { sendEmail, postWebhook, partnerEmail, consumerEmail } from './notify.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const CORE = new Set(['site', 'service', 'first_name', 'last_name', 'email', 'phone', 'zip', 'city', 'city_slug',
  'consent', 'consent_text', 'company_website', 'page_url', 'referrer', '_time_on_page_s', 'cf-turnstile-response',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']);

export const STATUSES = ['new', 'contacted', 'qualified', 'sold', 'return_requested', 'returned', 'dnc', 'bad'];
const DAY = 864e5;

/** Cloudflare Turnstile check. Returns 'passed', 'failed' or 'not_configured'. */
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return 'not_configured';
  if (!token) return 'failed';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || undefined })
    });
    const out = await res.json();
    return out.success ? 'passed' : 'failed';
  } catch { return 'failed'; }
}

/** 7-day count, last delivery and prepaid balance for one partner. */
export async function partnerStats(env, partnerId) {
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM leads WHERE partner_id = ?1 AND delivered_at > ?2) AS weekCount,
      (SELECT COUNT(*) FROM leads WHERE partner_id = ?1) AS totalDelivered,
      (SELECT MAX(delivered_at) FROM leads WHERE partner_id = ?1) AS lastAssignedAt,
      (SELECT COALESCE(SUM(amount), 0) FROM partner_credits WHERE partner_id = ?1) AS credits,
      (SELECT COALESCE(SUM(sold_price), 0) FROM leads WHERE partner_id = ?1 AND status != 'returned') AS spent`)
    .bind(partnerId, weekAgo).first();
  return {
    weekCount: r?.weekCount || 0, totalDelivered: r?.totalDelivered || 0, lastAssignedAt: r?.lastAssignedAt || '',
    credits: r?.credits || 0, spent: r?.spent || 0, balance: Math.round(((r?.credits || 0) - (r?.spent || 0)) * 100) / 100
  };
}

/**
 * POST /api/lead
 * @param registry { sites, verticals, partners } from lib/registry.generated.mjs
 */
export async function handleLead(request, env, registry, { waitUntil = (p) => p } = {}) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }

  // 1) Bot traps. Pretend success so bots don't learn.
  if (data.company_website) return json({ ok: true });
  if (Number(data._time_on_page_s) < 3) return json({ ok: true });

  // 2) Known site only (stops people posting junk into your DB).
  const siteCfg = registry.sites[data.site];
  if (!siteCfg) return json({ ok: false, error: 'Unknown site.' }, 400);
  const vertical = registry.verticals[siteCfg.vertical];

  // 3) Validation.
  const phone = normalizeUSPhone(data.phone);
  if (!phone) return json({ ok: false, error: 'Please enter a valid US phone number.' }, 422);
  if (!isValidEmail(data.email)) return json({ ok: false, error: 'Please enter a valid email.' }, 422);
  if (!/^\d{5}$/.test(String(data.zip || ''))) return json({ ok: false, error: 'Please enter a 5-digit ZIP code.' }, 422);
  if (!data.first_name || !data.last_name) return json({ ok: false, error: 'Please enter your name.' }, 422);
  if (data.consent !== 'yes' || !data.consent_text) return json({ ok: false, error: 'Please check the consent box to continue.' }, 422);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  const now = new Date().toISOString();

  // 4) Bot check (free Cloudflare Turnstile), when configured.
  const botCheck = await verifyTurnstile(env, data['cf-turnstile-response'], ip);
  if (botCheck === 'failed') return json({ ok: false, error: 'Please complete the quick security check above the button.' }, 403);

  // 5) Simple rate limit: max 5 leads / IP / 10 min.
  if (ip) {
    const since = new Date(Date.now() - 10 * 60e3).toISOString();
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > ?').bind(ip, since).first();
    if ((r?.n ?? 0) >= 5) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  // 6) Duplicate check (same phone + site in 30 days) — stored, flagged, never resold.
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const dup = await env.DB.prepare('SELECT id FROM leads WHERE phone = ? AND site = ? AND created_at > ? LIMIT 1')
    .bind(phone, data.site, since30).first();

  // 7) Answers + score. Sizes are capped, and anything that looks like an SSN
  // or card number typed into a free-text box is removed.
  const clean = (v) => String(v).slice(0, 1000)
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[removed]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[removed]');
  const answers = Object.fromEntries(Object.entries(data)
    .filter(([k]) => !CORE.has(k) && /^[a-z][a-z0-9_]{0,40}$/.test(k))
    .slice(0, 60)
    .map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 40).map(x => clean(x).slice(0, 200)) : clean(v)]));
  const age = ageFromDob(answers.dob);
  if (answers.dob && age !== null && age < 18) return json({ ok: false, error: 'You must be 18 or older to request quotes.' }, 422);
  const { score, tier, price: suggested } = scoreLead({ ...data, ...answers, phone }, vertical?.scoring);

  const s = (v, n = 200) => (v == null ? null : String(v).slice(0, n));
  const lead = {
    id: crypto.randomUUID(), created_at: now, site: data.site, vertical: siteCfg.vertical, service: s(data.service),
    first_name: s(data.first_name, 80), last_name: s(data.last_name, 80), email: s(data.email, 200).toLowerCase(),
    phone, zip: s(data.zip, 5), city: s(data.city, 80), city_slug: s(data.city_slug, 80), answers, score, tier,
    consent_text: s(data.consent_text, 2000), consent_at: now, ip: s(ip, 64)
  };

  // 8) Routing.
  const assignments = siteCfg.partners || [];
  const stats = {};
  for (const a of assignments) if (registry.partners?.[a.id]) stats[a.id] = await partnerStats(env, a.id);
  const route = choosePartner({
    lead: { tier, service: lead.service, citySlug: lead.city_slug, zip: lead.zip, consentText: lead.consent_text, duplicate: !!dup },
    assignments, partners: registry.partners || {}, stats
  });
  const partner = route.partner;
  const status = dup ? 'bad' : partner ? 'sold' : 'new';

  const consentHash = await sha256Hex(String(data.consent_text));
  const leadHash = await sha256Hex(`${lead.id}|${phone}|${now}|${data.site}`);
  const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']
    .filter(k => data[k]).map(k => [k, String(data[k]).slice(0, 200)]));

  await env.DB.prepare(`INSERT INTO leads (id, created_at, site, vertical, service, first_name, last_name, email, phone, zip, city, city_slug,
      answers_json, score, tier, suggested_price, duplicate_of, status, partner_id, delivered_at, buyer, sold_price, route_log,
      consent_text, consent_hash, consent_at, ip, user_agent, page_url, referrer, utm_json, time_on_page_s, bot_check, lead_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(lead.id, now, data.site, siteCfg.vertical, lead.service, lead.first_name, lead.last_name, lead.email, phone,
      lead.zip, lead.city, lead.city_slug, JSON.stringify(answers), score, tier, suggested, dup?.id || null, status,
      partner?.id || null, partner ? now : null, partner ? (partner.consentName || partner.name) : null, partner ? route.price : null,
      JSON.stringify(route.considered), lead.consent_text, consentHash, now, lead.ip, s(request.headers.get('user-agent'), 400),
      s(data.page_url, 500), s(data.referrer, 500), JSON.stringify(utm), Number(data._time_on_page_s) || 0, botCheck, leadHash)
    .run();

  // 9) Who the consumer should expect to hear from.
  const contact = dup ? null : partner
    ? { name: partner.name, company: partner.company || '', phone: partner.phone || '', bookingUrl: partner.bookingUrl || '' }
    : { name: siteCfg.buyers?.[0] || siteCfg.brand, company: '', phone: '', bookingUrl: siteCfg.bookingUrl || '' };

  // 10) Instant delivery (runs after the response, never blocks the consumer).
  if (!dup) {
    const full = { ...lead, ...{ consent_at: now } };
    const portalUrl = partner && siteCfg.domain && !/TODO/.test(siteCfg.domain) ? `https://${siteCfg.domain}/partner/` : '';
    const jobs = [];
    if (partner) {
      const m = partnerEmail({ lead: full, partner, site: siteCfg, vertical, portalUrl });
      jobs.push(sendEmail(env, { to: partner.email, ...m, replyTo: lead.email }));
      jobs.push(postWebhook(partner.webhook, `🔔 New ${tier}-lead for you: ${lead.first_name} ${lead.last_name} ${phone} · ${vertical?.services?.[lead.service] || ''} · ${lead.city || lead.zip}. Check your email for details.`));
    }
    // Operator copy: full details when the lead stays with you, a summary when routed.
    const forYou = !partner;
    if (env.OPERATOR_EMAIL && forYou) {
      const m = partnerEmail({ lead: full, partner: { name: contact.name }, site: siteCfg, vertical, portalUrl: '' });
      jobs.push(sendEmail(env, { to: env.OPERATOR_EMAIL, ...m, replyTo: lead.email }));
    }
    const who = env.NOTIFY_INCLUDE_PII === '1' ? `${lead.first_name} ${lead.last_name} ${phone}` : `${lead.first_name} (…${phone.slice(-4)})`;
    const routed = partner ? ` → ${partner.consentName || partner.name} ($${route.price})` : ' → you';
    jobs.push(postWebhook(env.NOTIFY_WEBHOOK, `🔔 ${tier}-lead (${score}) · ${siteCfg.brand} · ${vertical?.services?.[lead.service] || lead.service || ''} · ${lead.city || lead.zip} · ${who}${routed}`));
    const c = consumerEmail({ lead: full, contact, site: siteCfg });
    jobs.push(sendEmail(env, { to: lead.email, ...c, replyTo: partner?.email || env.OPERATOR_EMAIL || undefined }));
    waitUntil(Promise.allSettled(jobs));
  }
  return json({ ok: true, id: lead.id, contact });
}

// ------------------------------------------------------------- admin API ---

/** Auth for admin endpoints: Authorization: Bearer <ADMIN_TOKEN> */
function authed(request, env) {
  const h = request.headers.get('authorization') || '';
  return env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24 && h === `Bearer ${env.ADMIN_TOKEN}`;
}

/** GET /api/leads?since=ISO&site=slug&format=csv */
export async function handleListLeads(request, env) {
  if (!authed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  const since = u.searchParams.get('since') || '1970-01-01';
  const site = u.searchParams.get('site');
  // updated_at is included so status changes made by partners (return requests) come down too.
  const q = site
    ? env.DB.prepare('SELECT * FROM leads WHERE (created_at > ? OR updated_at > ?) AND site = ? ORDER BY created_at DESC LIMIT 5000').bind(since, since, site)
    : env.DB.prepare('SELECT * FROM leads WHERE (created_at > ? OR updated_at > ?) ORDER BY created_at DESC LIMIT 5000').bind(since, since);
  const { results = [] } = await q.all();
  if (u.searchParams.get('format') === 'csv') {
    return new Response(toCSV(results), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="leads.csv"' } });
  }
  return json({ ok: true, count: results.length, leads: results, serverTime: new Date().toISOString() });
}

/** PATCH /api/leads  body: { id, status?, buyer?, sold_price?, notes?, partner_id?, chain_tx? } */
export async function handleUpdateLead(request, env) {
  if (!authed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const allowed = ['status', 'buyer', 'sold_price', 'notes', 'partner_id', 'chain_tx'];
  if (!b.id) return json({ ok: false, error: 'id required' }, 400);
  if (b.status && !STATUSES.includes(b.status)) return json({ ok: false, error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  const sets = allowed.filter(k => k in b);
  if (!sets.length) return json({ ok: false, error: 'nothing to update' }, 400);
  await env.DB.prepare(`UPDATE leads SET ${sets.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...sets.map(k => b[k]), new Date().toISOString(), b.id).run();
  return json({ ok: true });
}

/** GET /api/partner-credits → balances for every partner in the registry. POST → record a payment/adjustment. */
export async function handlePartnerCredits(request, env, registry) {
  if (!authed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (!b.partner_id || !Number.isFinite(Number(b.amount)) || Number(b.amount) === 0) return json({ ok: false, error: 'partner_id and a non-zero amount are required' }, 400);
    await env.DB.prepare('INSERT INTO partner_credits (id, partner_id, amount, note, created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), String(b.partner_id).slice(0, 80), Number(b.amount), String(b.note || '').slice(0, 300), new Date().toISOString()).run();
  }
  const out = {};
  for (const id of Object.keys(registry.partners || {})) out[id] = await partnerStats(env, id);
  const { results: history = [] } = await env.DB.prepare('SELECT * FROM partner_credits ORDER BY created_at DESC LIMIT 500').all();
  return json({ ok: true, partners: out, history });
}

// ---------------------------------------------------------- partner portal ---

async function partnerFromToken(request, registry) {
  const h = request.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token.length < 16) return null;
  const hash = await sha256Hex(token);
  const entry = Object.entries(registry.partners || {}).find(([, p]) => p.tokenHash && p.tokenHash === hash);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

/** GET /api/partner → the partner's own leads and balance. POST {action:'return', id, reason}. */
export async function handlePartner(request, env, registry, { waitUntil = (p) => p } = {}) {
  const partner = await partnerFromToken(request, registry);
  if (!partner) return json({ ok: false, error: 'That access code is not valid. Ask for a new link.' }, 401);

  if (request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    if (b.action !== 'return' || !b.id) return json({ ok: false, error: 'Unknown action.' }, 400);
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (!reason) return json({ ok: false, error: 'Please say why (e.g. wrong number).' }, 422);
    const lead = await env.DB.prepare('SELECT id, status, delivered_at, notes, first_name FROM leads WHERE id = ? AND partner_id = ?').bind(b.id, partner.id).first();
    if (!lead) return json({ ok: false, error: 'Lead not found.' }, 404);
    if (lead.status !== 'sold') return json({ ok: false, error: 'A return was already requested or handled for this lead.' }, 409);
    if (Date.now() - Date.parse(lead.delivered_at) > 3 * DAY) return json({ ok: false, error: 'Returns must be requested within 72 hours of delivery.' }, 409);
    const now = new Date().toISOString();
    const note = [lead.notes, `${now.slice(0, 10)} return requested by ${partner.name}: ${reason}`].filter(Boolean).join('\n');
    await env.DB.prepare("UPDATE leads SET status = 'return_requested', notes = ?, updated_at = ? WHERE id = ?").bind(note, now, lead.id).run();
    waitUntil(postWebhook(env.NOTIFY_WEBHOOK, `↩️ Return requested by ${partner.name} for ${lead.first_name}: ${reason}. Approve or reject in the admin (Leads).`));
    return json({ ok: true });
  }

  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const { results = [] } = await env.DB.prepare(`SELECT id, created_at, delivered_at, site, vertical, service, first_name, last_name, email, phone,
      zip, city, answers_json, tier, score, status, sold_price, consent_text, consent_at
      FROM leads WHERE partner_id = ? AND delivered_at > ? ORDER BY delivered_at DESC LIMIT 500`).bind(partner.id, since).all();
  const stats = await partnerStats(env, partner.id);
  return json({
    ok: true,
    partner: {
      name: partner.name, company: partner.company, pricePerLead: partner.pricePerLead, priceByTier: partner.priceByTier,
      weeklyCap: partner.weeklyCap, prepaid: partner.prepaid, payLink: partner.payLink || '', active: partner.active, ...stats
    },
    verticals: Object.fromEntries(Object.entries(registry.verticals).map(([k, v]) => [k, { labels: v.labels, services: v.services }])),
    leads: results
  });
}

export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    // Leading = + - @ can execute as formulas in Excel/Sheets: neutralize.
    const safe = /^[=+\-@]/.test(t) && !/^[+-]?\d/.test(t) ? `'${t}` : t;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}
