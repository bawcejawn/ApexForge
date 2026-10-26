// lib/routing.mjs
// -----------------------------------------------------------------------------
// Decides which partner (if any) receives a new lead. Pure functions only: no
// database, no network, so the rules are easy to test and to read.
//
// A partner gets a lead only if ALL of these are true:
//   1. The partner is active.
//   2. The partner is assigned to this site and matches the lead's city/ZIP
//      and service (empty lists mean "any").
//   3. The lead's tier is at or above the partner's minimum tier.
//   4. The partner's name appears in the consent text the consumer agreed to.
//      (The legal guard: a lead never goes to someone it didn't consent to.)
//   5. The lead isn't a duplicate.
//   6. The partner is under their 7-day cap.
//   7. Prepaid partners have enough balance for this lead's price.
// Among eligible partners, the one who waited longest since their last lead
// wins (simple round-robin). No eligible partner → the operator keeps the lead.
// -----------------------------------------------------------------------------

export const TIER_RANK = { A: 3, B: 2, C: 1 };

/** Price for this lead: per-tier price if above 0, else the flat price. */
export function priceFor(partner, tier) {
  const tierPrice = Number(partner.priceByTier?.[tier]) || 0;
  return tierPrice > 0 ? tierPrice : Number(partner.pricePerLead) || 0;
}

/**
 * Explain why a partner can or can't take this lead.
 * @returns {{ ok: boolean, reason: string, price: number }}
 */
export function checkPartner({ lead, assignment, partner, stats = {} }) {
  const price = priceFor(partner, lead.tier);
  const no = (reason) => ({ ok: false, reason, price });
  if (!partner) return no('unknown partner');
  if (!partner.active) return no('paused');
  if (lead.duplicate) return no('duplicate lead');
  const cities = assignment.cities || [];
  const zips = assignment.zips || [];
  if (cities.length || zips.length) {
    const inArea = cities.includes(lead.citySlug) || zips.includes(lead.zip);
    if (!inArea) return no('outside service area');
  }
  if ((assignment.services || []).length && !assignment.services.includes(lead.service)) return no('service not covered');
  const minTier = assignment.minTier || partner.minTier || 'C';
  if ((TIER_RANK[lead.tier] || 0) < (TIER_RANK[minTier] || 1)) return no(`below tier ${minTier}`);
  const named = partner.consentName || partner.name;
  if (!named || !String(lead.consentText || '').includes(named)) return no('not named in consent');
  if (partner.weeklyCap && (stats.weekCount || 0) >= partner.weeklyCap) return no('weekly cap reached');
  if (partner.prepaid && (stats.balance ?? 0) < price) return no('balance too low');
  return { ok: true, reason: 'eligible', price };
}

/**
 * Pick a partner for a lead.
 * @param assignments [{ id, cities?, zips?, services?, minTier? }] from site.json "partners"
 * @param partners    { [id]: partner } from private/partners.json
 * @param stats       { [id]: { weekCount, balance, lastAssignedAt } }
 * @returns {{ partner: object|null, price: number, considered: Array<{id, reason}> }}
 */
export function choosePartner({ lead, assignments = [], partners = {}, stats = {} }) {
  const considered = [];
  const eligible = [];
  for (const a of assignments) {
    const p = partners[a.id];
    const r = checkPartner({ lead, assignment: a, partner: p, stats: stats[a.id] });
    considered.push({ id: a.id, reason: r.reason });
    if (r.ok) eligible.push({ partner: { id: a.id, ...p }, price: r.price, last: stats[a.id]?.lastAssignedAt || '' });
  }
  if (!eligible.length) return { partner: null, price: 0, considered };
  eligible.sort((x, y) => x.last.localeCompare(y.last)); // longest-waiting first ('' = never)
  return { partner: eligible[0].partner, price: eligible[0].price, considered };
}

/** Partners named in a page's consent: everyone assigned to the site who covers that city. */
export function partnersForPage({ assignments = [], partners = {}, citySlug }) {
  return assignments
    .filter(a => partners[a.id]?.active !== false && partners[a.id]?.name)
    .filter(a => !citySlug || !(a.cities || []).length || a.cities.includes(citySlug))
    .map(a => partners[a.id]);
}
