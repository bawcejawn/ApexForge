// functions/api/leads.js — operator admin API (Bearer ADMIN_TOKEN)
//   GET   /api/leads?since=2026-10-01&site=<slug>&format=csv
//   PATCH /api/leads   { id, status, buyer, sold_price, notes, chain_tx }
import { handleListLeads, handleUpdateLead } from '../../lib/lead-handler.mjs';

export const onRequestGet = (ctx) => handleListLeads(ctx.request, ctx.env);
export const onRequestPatch = (ctx) => handleUpdateLead(ctx.request, ctx.env);
