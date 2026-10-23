// koinos/contract/assembly/LeadRegistry.ts — SKETCH (AssemblyScript, Koinos SDK style)
// -----------------------------------------------------------------------------
// NOT compiled or audited. Shows the intended shape of the on-chain lead
// registry so it can be built with the Koinos AssemblyScript SDK
// (@koinos/sdk-as) and the koinos-cli/`koinos-sdk-as-cli` toolchain.
//
// State: lead_hash -> LeadRecord { vertical, tier, status, buyer, price_cents, updated }
// Only the contract owner (the operator) may write. Reads are public, which lets
// a buyer independently verify "this lead was created at time T, sold once, to
// me, at price P" without ever seeing PII.
//
// Upgradability: Koinos contracts can be re-uploaded to the same address by the
// owner, so this logic can evolve (e.g. buyer-signed acceptance, escrow)
// without migrating state — one of the genuine Koinos advantages.
// -----------------------------------------------------------------------------
import { System, Storage, Arrays, Protobuf, authority } from "@koinos/sdk-as";
import { leadregistry } from "./proto/leadregistry";

const RECORDS_SPACE_ID = 0;

export class LeadRegistry {
  contractId: Uint8Array = System.getContractId();

  records: Storage.Map<string, leadregistry.lead_record> = new Storage.Map(
    this.contractId,
    RECORDS_SPACE_ID,
    leadregistry.lead_record.decode,
    leadregistry.lead_record.encode,
    () => new leadregistry.lead_record()
  );

  /** Only the operator (contract account) can write. */
  private onlyOwner(): void {
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.contractId),
      "LeadRegistry: not authorized"
    );
  }

  /** register_lead: anchor a new lead hash. Fails if it already exists (no double-selling). */
  register_lead(args: leadregistry.event_args): leadregistry.empty {
    this.onlyOwner();
    System.require(!this.records.get(args.lead_hash)!.updated, "lead already registered");
    const rec = new leadregistry.lead_record(args.vertical, args.tier, "listed", "", 0, System.getHeadInfo().head_block_time);
    this.records.put(args.lead_hash, rec);
    System.event("leadregistry.listed", Protobuf.encode(args, leadregistry.event_args.encode), []);
    return new leadregistry.empty();
  }

  /** record_sale: a lead may be sold exactly once (exclusive leads). */
  record_sale(args: leadregistry.event_args): leadregistry.empty {
    this.onlyOwner();
    const rec = this.records.get(args.lead_hash)!;
    System.require(rec.status == "listed", "lead not available");
    rec.status = "sold";
    rec.buyer = args.buyer;
    rec.price_cents = args.price_cents;
    rec.updated = System.getHeadInfo().head_block_time;
    this.records.put(args.lead_hash, rec);
    System.event("leadregistry.sold", Protobuf.encode(args, leadregistry.event_args.encode), []);
    return new leadregistry.empty();
  }

  record_acceptance(args: leadregistry.event_args): leadregistry.empty {
    this.onlyOwner();
    const rec = this.records.get(args.lead_hash)!;
    System.require(rec.status == "sold", "lead not sold");
    rec.status = "accepted";
    rec.updated = System.getHeadInfo().head_block_time;
    this.records.put(args.lead_hash, rec);
    return new leadregistry.empty();
  }

  record_return(args: leadregistry.event_args): leadregistry.empty {
    this.onlyOwner();
    const rec = this.records.get(args.lead_hash)!;
    System.require(rec.status == "sold" || rec.status == "accepted", "lead not sold");
    rec.status = "returned";
    rec.updated = System.getHeadInfo().head_block_time;
    this.records.put(args.lead_hash, rec);
    return new leadregistry.empty();
  }

  /** get_lead (read-only): anyone can verify a lead's history by its hash. */
  get_lead(args: leadregistry.event_args): leadregistry.lead_record {
    return this.records.get(args.lead_hash)!;
  }
}
