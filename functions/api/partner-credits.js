// functions/api/partner-credits.js — operator only (Bearer ADMIN_TOKEN)
//   GET  /api/partner-credits                          → balances + payment history
//   POST /api/partner-credits {partner_id, amount, note} → record a payment or adjustment
import { handlePartnerCredits } from '../../lib/lead-handler.mjs';
import registry from '../../lib/registry.generated.mjs';

export const onRequest = (ctx) => handlePartnerCredits(ctx.request, ctx.env, registry);
