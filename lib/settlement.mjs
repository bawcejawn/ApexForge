// lib/settlement.mjs
// -----------------------------------------------------------------------------
// Settlement adapter: where lead "events" (created, sold, accepted, returned)
// get anchored for auditability. The CRM never calls a chain directly — it
// calls this interface, so swapping Koinos for anything else is one line.
//
//   const s = await getSettlement();          // reads SETTLEMENT env
//   await s.record({ type: 'sold', leadHash, buyer, priceCents });
//
// SETTLEMENT=none     (default) no-op, returns null
// SETTLEMENT=log      append-only hash-chained file data/ledger.jsonl (free,
//                     tamper-evident; publish the head hash anywhere to anchor)
// SETTLEMENT=koinos   koinos/client.mjs (requires koilib + funded operator key)
//
// RULE: only hashes, tiers, prices and pseudonymous buyer IDs leave the CRM.
// Never put names, phones, emails or ZIPs on any chain — it's permanent and
// public, and would violate privacy law and your own privacy policy.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core.mjs';
import { sha256Hex } from './scoring.mjs';

export const EVENT_TYPES = ['created', 'listed', 'sold', 'accepted', 'returned', 'refunded'];

function validate(ev) {
  if (!EVENT_TYPES.includes(ev.type)) throw new Error(`event type must be one of ${EVENT_TYPES.join(', ')}`);
  if (!/^[0-9a-f]{64}$/.test(ev.leadHash || '')) throw new Error('leadHash must be a sha256 hex string');
  const allowed = new Set(['type', 'leadHash', 'vertical', 'tier', 'buyer', 'priceCents']);
  for (const k of Object.keys(ev)) if (!allowed.has(k)) throw new Error(`field "${k}" not allowed in settlement events (PII guard)`);
}

/** Free, local, tamper-evident ledger. Each line includes the previous line's hash. */
class LogSettlement {
  constructor(file = path.join(ROOT, 'data', 'ledger.jsonl')) { this.file = file; }
  async record(ev) {
    validate(ev);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lines = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean) : [];
    const prev = lines.length ? JSON.parse(lines.at(-1)).hash : '0'.repeat(64);
    const entry = { ...ev, at: new Date().toISOString(), prev };
    entry.hash = await sha256Hex(JSON.stringify(entry));
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return { ref: entry.hash };
  }
}

export async function getSettlement(kind = process.env.SETTLEMENT || 'none') {
  if (kind === 'log') return new LogSettlement();
  if (kind === 'koinos') {
    const { KoinosSettlement } = await import('../koinos/client.mjs');
    return new KoinosSettlement({ validate });
  }
  return { async record(ev) { validate(ev); return null; } };
}
