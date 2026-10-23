// koinos/client.mjs — SKETCH. Not wired into the default flow.
// -----------------------------------------------------------------------------
// Records lead events on the lead-registry contract (koinos/contract/) using
// koilib. The OPERATOR's key signs every transaction and its KOIN balance
// generates the mana that pays for them, so consumers and buyers never see a
// wallet, a token, or a fee. That's the "invisible chain" UX.
//
// Setup (only if you decide Koinos is worth it — see koinos/README.md):
//   npm i koilib
//   .env: SETTLEMENT=koinos
//         KOINOS_RPC=https://api.koinos.io
//         KOINOS_OPERATOR_WIF=<private key — NEVER commit>
//         KOINOS_REGISTRY_ID=<deployed contract address>
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export class KoinosSettlement {
  constructor({ validate }) {
    this.validate = validate;
  }

  async init() {
    if (this.contract) return;
    // Imported lazily so the rest of ApexForge runs without koilib installed.
    const { Signer, Provider, Contract } = await import('koilib');
    const provider = new Provider([process.env.KOINOS_RPC || 'https://api.koinos.io']);
    const signer = Signer.fromWif(process.env.KOINOS_OPERATOR_WIF);
    signer.provider = provider;
    const abi = JSON.parse(fs.readFileSync(path.join(here, 'contract', 'lead-registry.abi.json'), 'utf8'));
    this.contract = new Contract({ id: process.env.KOINOS_REGISTRY_ID, abi, provider, signer });
  }

  /** ev: { type, leadHash, vertical?, tier?, buyer?, priceCents? } (hashes only, no PII) */
  async record(ev) {
    this.validate(ev);
    await this.init();
    const fn = {
      created: 'register_lead', listed: 'register_lead', sold: 'record_sale',
      accepted: 'record_acceptance', returned: 'record_return', refunded: 'record_return'
    }[ev.type];
    const { transaction, receipt } = await this.contract.functions[fn]({
      lead_hash: ev.leadHash,
      vertical: ev.vertical || '',
      tier: ev.tier || '',
      buyer: ev.buyer || '',              // pseudonymous buyer ID, not a name
      price_cents: String(ev.priceCents || 0)
    });
    await transaction.wait();             // ~3s block time
    return { ref: transaction.id, mana: receipt?.rc_used };
  }
}
