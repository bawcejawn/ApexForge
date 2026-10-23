// lib/scoring.mjs
// -----------------------------------------------------------------------------
// Pure lead-scoring + validation helpers. NO Node/fs imports here, because this
// file is bundled into the Cloudflare Pages Function (functions/api/lead.js)
// AND used by local scripts. Keep it dependency-free.
// -----------------------------------------------------------------------------

/** Disposable / throwaway email domains. Extend freely. */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com'
]);

/**
 * Normalize a US phone number to E.164 (+1XXXXXXXXXX) or return null.
 * Rejects obvious fakes (555-01xx, repeated digits, invalid area/exchange codes).
 */
export function normalizeUSPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length !== 10) return null;
  const area = d.slice(0, 3), exch = d.slice(3, 6);
  if (/^[01]/.test(area) || /^[01]/.test(exch)) return null;     // NANP rules
  if (/^(\d)\1{9}$/.test(d)) return null;                         // 1111111111
  if (exch === '555' && /^01\d\d$/.test(d.slice(6))) return null; // fictional range
  if (d === '1234567890') return null;
  return '+1' + d;
}

export function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(raw || '').trim());
}

export function isDisposableEmail(raw) {
  const domain = String(raw || '').split('@')[1]?.toLowerCase().trim();
  return !!domain && DISPOSABLE.has(domain);
}

/**
 * Score a lead 0-100 using the vertical's `scoring.rules`.
 * Derived fields (prefixed `_`) are computed here so rules can reference them.
 *
 * Rule shapes:
 *   { field, in: [...values], points }   value is one of the list
 *   { field, present: true, points }     value is non-empty
 *   { field, min: n, points }            numeric value >= n
 */
export function scoreLead(fields, scoring) {
  const f = {
    ...fields,
    _phone_valid: !!normalizeUSPhone(fields.phone),
    _email_freemail_disposable: isDisposableEmail(fields.email),
    _time_on_page_s: Number(fields._time_on_page_s || 0),
    _age: ageFromDob(fields.dob)
  };
  let score = 0;
  const hits = [];
  for (const r of scoring?.rules || []) {
    const v = f[r.field];
    let match = false;
    // Checkbox groups arrive as arrays: "in" matches if ANY selected value is listed.
    if (Array.isArray(r.in)) match = Array.isArray(v) ? v.some(x => r.in.includes(x)) : r.in.includes(v);
    else if (r.present) match = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '';
    else if (typeof r.min === 'number' || typeof r.max === 'number') {
      const n = Number(v);
      match = v !== null && v !== undefined && v !== '' && !Number.isNaN(n) &&
        (typeof r.min !== 'number' || n >= r.min) && (typeof r.max !== 'number' || n <= r.max);
    }
    if (match) { score += r.points; hits.push(`${r.field}:${r.points > 0 ? '+' : ''}${r.points}`); }
  }
  score = Math.max(0, Math.min(100, score));
  const t = scoring?.tiers || { A: 70, B: 45 };
  const tier = score >= t.A ? 'A' : score >= t.B ? 'B' : 'C';
  const price = scoring?.suggestedPrice?.[tier] ?? null;
  return { score, tier, price, hits };
}

/** Age in whole years from a YYYY-MM-DD date of birth, or null if missing/invalid. */
export function ageFromDob(dob, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age >= 0 && age < 120 ? age : null;
}

/** SHA-256 hex digest (works in Workers and Node 20+ via globalThis.crypto). */
export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
