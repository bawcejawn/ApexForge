// lib/partners.mjs
// -----------------------------------------------------------------------------
// Partner directory: the realtors, lenders and agents who buy leads.
//
// Stored in private/partners.json, which is NOT committed to git (it holds
// partners' emails, phones and portal codes, and the repo is public). The build
// bundles it into the lead API, which runs privately on Cloudflare.
// Edit it in the admin: Partners.
//
// Back it up: it lives only on your PC. The admin's Partners page has an
// Export button, and the Sync script reminds you.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, slugify } from './core.mjs';

export const PARTNERS_FILE = path.join(ROOT, 'private', 'partners.json');

/** Field list with defaults. Order = order shown in the admin. */
export const PARTNER_FIELDS = {
  name: '',            // Person's name exactly as it should appear in consent
  company: '',         // Brokerage / lender / agency
  license: '',         // e.g. "SC RE License #12345" or "NMLS #12345"
  email: '',           // Lead delivery email
  phone: '',           // Shown to the consumer after they submit
  bookingUrl: '',      // Partner's own Cal.com / Calendly link (consumer books with them)
  webhook: '',         // Optional: Discord/Slack/Zapier URL for instant alerts
  payLink: '',         // Optional: Stripe Payment Link for buying more leads
  pricePerLead: 0,     // Flat price per delivered lead ($)
  priceByTier: { A: 0, B: 0, C: 0 }, // Optional per-tier prices; 0 = use flat price
  weeklyCap: 10,       // Max leads in any 7 days (0 = no cap)
  minTier: 'B',        // Lowest tier this partner receives: A, B or C
  prepaid: true,       // Only deliver while they have prepaid balance
  active: true,
  portalToken: ''      // Secret code for the partner portal (generated)
};

export const newToken = () => crypto.randomBytes(18).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function loadPartners() {
  if (!fs.existsSync(PARTNERS_FILE)) return {};
  const raw = JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8').replace(/^﻿/, ''));
  const out = {};
  for (const [id, p] of Object.entries(raw.partners || {})) {
    out[id] = { ...PARTNER_FIELDS, ...p, priceByTier: { ...PARTNER_FIELDS.priceByTier, ...(p.priceByTier || {}) } };
  }
  return out;
}

export function savePartners(partners) {
  fs.mkdirSync(path.dirname(PARTNERS_FILE), { recursive: true });
  fs.writeFileSync(PARTNERS_FILE, JSON.stringify({
    _comment: 'Private partner directory. Not committed to git. Edit in the admin under Partners.',
    partners
  }, null, 2) + '\n');
}

/** Make a unique id from a name, e.g. "Jane Smith" -> "jane-smith". */
export function partnerId(name, existing = {}) {
  const base = slugify(name) || 'partner';
  let id = base, n = 2;
  while (existing[id]) id = `${base}-${n++}`;
  return id;
}

/** "Jane Smith of ABC Realty" — the exact phrase used in consent text. */
export const consentName = (p) => (p.company ? `${p.name} of ${p.company}` : p.name);
