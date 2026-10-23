// functions/api/lead.js — Cloudflare Pages Function: POST /api/lead
// Thin wrapper; all logic lives in lib/lead-handler.mjs (unit-tested).
import { handleLead } from '../../lib/lead-handler.mjs';
import registry from '../../lib/registry.generated.mjs';

export async function onRequestPost(context) {
  try {
    return await handleLead(context.request, context.env, registry, { waitUntil: (p) => context.waitUntil(p) });
  } catch (e) {
    console.error('lead error', e);
    return new Response(JSON.stringify({ ok: false, error: 'Server error. Please call or try again.' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
