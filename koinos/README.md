# Koinos settlement layer (optional)

**Status: sketch. Off by default. ApexForge runs, captures, sells and reports leads without it.**

## What it does

Anchors lead lifecycle events so a buyer can independently verify that a lead was created at time T, sold once (exclusive), to them, at price P. Nothing personal goes on chain, only hashes.

```
lead submitted ──► D1 row (PII, consent proof) ──► lead_hash = sha256(id|phone|created_at|site)
                                                     │
operator marks "sold" in CRM ──► settlement.record({ type:'sold', leadHash, buyer:'B-0007', priceCents:6500 })
                                                     │
                                  SETTLEMENT=log    → data/ledger.jsonl (hash-chained, free)
                                  SETTLEMENT=koinos → LeadRegistry.record_sale (mana-paid, ~3s)
```

## Why it's invisible to users

- **Consumers** never touch it. They fill a form.
- **Buyers** never need a wallet. The operator's key signs every transaction, and the KOIN it holds regenerates the mana that pays for them. Buyers verify by looking up a lead hash (a read, which is free).
- Later, buyers who *want* self-custody can sign `record_acceptance` themselves with a Koinos wallet; the contract can be upgraded in place to allow that.

## Honest assessment (October 2026)

KOIN's market data is weak: a market cap under $1M, roughly $1k of daily volume, and a ~97% drop over the past year. That has three consequences:

1. **Don't take payment in KOIN.** Settle money in USD (ACH, Zelle, invoice, or Stripe if a buyer insists; Stripe has no monthly fee, only per-transaction). Use the chain, if at all, for audit anchoring.
2. **Holding KOIN for mana is a small, risky position.** Buy only the minimum needed to cover your transaction volume.
3. **Network continuity is a real risk** for a chain with this little activity. That's why everything goes through `lib/settlement.mjs`: if Koinos stops being viable, set `SETTLEMENT=log` and nothing else changes.

`SETTLEMENT=log` gives you ~90% of the value for $0: a tamper-evident ledger. Publish its latest hash daily (a public GitHub gist, or OpenTimestamps for a free Bitcoin timestamp) and you can prove the ledger wasn't rewritten.

## To build the real thing

1. `npm i koilib` and scaffold with the Koinos AssemblyScript SDK (`@koinos/sdk-as`).
2. Generate proto bindings from `leadregistry.proto`; port `assembly/LeadRegistry.ts` (it follows the SDK's patterns but has not been compiled).
3. Deploy to **Harbinger testnet** first; regenerate `lead-registry.abi.json` from the build.
4. Fund the operator account with enough KOIN for mana, set the env vars in `client.mjs`, and set `SETTLEMENT=koinos`.
5. Get the contract reviewed before mainnet. Contract bugs here mean double-sold or unverifiable leads.
