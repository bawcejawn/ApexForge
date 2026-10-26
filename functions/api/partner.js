// functions/api/partner.js — partner portal API (Bearer <partner access code>)
//   GET  /api/partner                      → the partner's leads + balance
//   POST /api/partner {action:'return', id, reason}
import { handlePartner } from '../../lib/lead-handler.mjs';
import registry from '../../lib/registry.generated.mjs';

export const onRequest = (ctx) => handlePartner(ctx.request, ctx.env, registry, { waitUntil: (p) => ctx.waitUntil(p) });
