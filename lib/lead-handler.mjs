// lib/lead-handler.mjs
// -----------------------------------------------------------------------------
// Runtime logic for the lead API, written as plain functions so it can be unit
// tested in Node (tests/lead.test.mjs) and wrapped by Cloudflare Pages
// Functions (functions/api/*.js). No Node-only imports allowed here.
//
// env bindings (Cloudflare dashboard -> Pages project -> Settings):
//   DB               D1 database binding (required)
//   ADMIN_TOKEN      secret for /api/leads (required for admin)
//   NOTIFY_WEBHOOK   Discord/Slack-compatible webhook URL (optional, free)
//   NOTIFY_INCLUDE_PII  "1" to include phone/name in notifications (optional)
// -----------------------------------------------------------------------------
import { scoreLead, normalizeUSPhone, isValidEmail, sha256Hex, ageFromDob } from './scoring.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CORE = new Set(['site', 'service', 'first_name', 'last_name', 'email', 'phone', 'zip', 'city',
  'consent', 'consent_text', 'company_website', 'page_url', 'referrer', '_time_on_page_s',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']);

/**
 * POST /api/lead
 * @param registry { sites: { [slug]: { vertical, brand, buyers } }, verticals: { [id]: { scoring } } }
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

  // 4) Simple rate limit: max 5 leads / IP / 10 min.
  if (ip) {
    const since = new Date(Date.now() - 10 * 60e3).toISOString();
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND created_at > ?').bind(ip, since).first();
    if ((r?.n ?? 0) >= 5) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  // 5) Duplicate check (same phone + site in 30 days) — stored, flagged, not resold.
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const dup = await env.DB.prepare('SELECT id FROM leads WHERE phone = ? AND site = ? AND created_at > ? LIMIT 1')
    .bind(phone, data.site, since30).first();

  // 6) Score + store.
  // Vertical-specific answers (the "application"). Sizes are capped, and
  // anything that looks like an SSN or card number typed into a free-text box
  // is removed: those must only ever be entered in a carrier's own e-app.
  const clean = (v) => String(v).slice(0, 1000)
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[removed]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[removed]');
  const answers = Object.fromEntries(Object.entries(data)
    .filter(([k]) => !CORE.has(k) && /^[a-z][a-z0-9_]{0,40}$/.test(k))
    .slice(0, 60)
    .map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 40).map(x => clean(x).slice(0, 200)) : clean(v)]));
  const age = ageFromDob(answers.dob);
  if (answers.dob && age !== null && age < 18) return json({ ok: false, error: 'You must be 18 or older to request quotes.' }, 422);
  const { score, tier, price } = scoreLead({ ...data, ...answers, phone }, vertical?.scoring);
  const id = crypto.randomUUID();
  const consentHash = await sha256Hex(String(data.consent_text));
  const leadHash = await sha256Hex(`${id}|${phone}|${now}|${data.site}`);
  const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']
    .filter(k => data[k]).map(k => [k, String(data[k]).slice(0, 200)]));
  const s = (v, n = 200) => (v == null ? null : String(v).slice(0, n));

  await env.DB.prepare(`INSERT INTO leads (id, created_at, site, vertical, service, first_name, last_name, email, phone, zip, city,
      answers_json, score, tier, suggested_price, duplicate_of, status, consent_text, consent_hash, consent_at,
      ip, user_agent, page_url, referrer, utm_json, time_on_page_s, lead_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, now, data.site, siteCfg.vertical, s(data.service), s(data.first_name, 80), s(data.last_name, 80),
      s(data.email, 200).toLowerCase(), phone, s(data.zip, 5), s(data.city, 80),
      JSON.stringify(answers), score, tier, price, dup?.id || null, dup ? 'bad' : 'new',
      s(data.consent_text, 2000), consentHash, now,
      s(ip, 64), s(request.headers.get('user-agent'), 400), s(data.page_url, 500), s(data.referrer, 500),
      JSON.stringify(utm), Number(data._time_on_page_s) || 0, leadHash)
    .run();

  // 7) Notify operator (non-blocking).
  if (env.NOTIFY_WEBHOOK && !dup) {
    const who = env.NOTIFY_INCLUDE_PII === '1' ? `${data.first_name} ${data.last_name} ${phone}` : `${data.first_name} (…${phone.slice(-4)})`;
    const text = `🔔 New ${tier}-lead (${score}) · ${siteCfg.brand} · ${data.service || ''} · ${data.city || data.zip} · ${who}`;
    waitUntil(fetch(env.NOTIFY_WEBHOOK, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text, text })
    }).catch(() => {}));
  }
  return json({ ok: true, id });
}

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
  const q = site
    ? env.DB.prepare('SELECT * FROM leads WHERE created_at > ? AND site = ? ORDER BY created_at DESC LIMIT 5000').bind(since, site)
    : env.DB.prepare('SELECT * FROM leads WHERE created_at > ? ORDER BY created_at DESC LIMIT 5000').bind(since);
  const { results = [] } = await q.all();
  if (u.searchParams.get('format') === 'csv') {
    return new Response(toCSV(results), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="leads.csv"' } });
  }
  return json({ ok: true, count: results.length, leads: results });
}

/** PATCH /api/leads  body: { id, status?, buyer?, sold_price?, notes?, chain_tx? } — CRM updates. */
export async function handleUpdateLead(request, env) {
  if (!authed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const allowed = ['status', 'buyer', 'sold_price', 'notes', 'chain_tx'];
  const STATUSES = ['new', 'contacted', 'qualified', 'sold', 'returned', 'dnc', 'bad'];
  if (!b.id) return json({ ok: false, error: 'id required' }, 400);
  if (b.status && !STATUSES.includes(b.status)) return json({ ok: false, error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  const sets = allowed.filter(k => k in b);
  if (!sets.length) return json({ ok: false, error: 'nothing to update' }, 400);
  await env.DB.prepare(`UPDATE leads SET ${sets.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...sets.map(k => b[k]), new Date().toISOString(), b.id).run();
  return json({ ok: true });
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
