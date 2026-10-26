// lib/notify.mjs
// -----------------------------------------------------------------------------
// Instant delivery when a lead comes in. Runs inside the Cloudflare function.
//   - Email the lead to the partner (or to you) with every answer.
//   - Email the consumer a confirmation naming who will contact them.
//   - Ping Discord/Slack webhooks.
// Email uses Resend's free tier (100/day, 3,000/month). Set in Cloudflare:
//   RESEND_API_KEY   from resend.com (free account)
//   EMAIL_FROM       e.g. "Grand Strand Home Value <hello@yourdomain.com>"
//   OPERATOR_EMAIL   where your own copies go (optional)
// Without these, email is skipped and everything else still works.
// No Node-only imports here.
// -----------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !to) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) })
  });
  return { ok: res.ok, status: res.status };
}

export async function postWebhook(url, text) {
  if (!url) return { skipped: true };
  // "content" for Discord, "text" for Slack/Zapier/Make.
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
  return { ok: res.ok };
}

/** Labeled answer rows in form order: [["Coverage amount", "$25,000 - $50,000"], ...] */
export function answerRows(lead, vertical) {
  const labels = vertical?.labels || {};
  const svc = vertical?.services?.[lead.service] || lead.service;
  const rows = [['Interested in', svc]];
  for (const [k, v] of Object.entries(lead.answers || {})) {
    if (v === '' || v == null || k === 'city_slug') continue;
    rows.push([String(labels[k] || k.replace(/_/g, ' ')).replace(/ /g, '').trim() || k, Array.isArray(v) ? v.join(', ') : String(v)]);
  }
  return rows;
}

/** The email a partner receives the moment a lead is routed to them. */
export function partnerEmail({ lead, partner, site, vertical, portalUrl }) {
  const rows = answerRows(lead, vertical);
  const where = [lead.city, lead.zip].filter(Boolean).join(' ');
  const subject = `New ${lead.tier}-lead: ${vertical?.services?.[lead.service] || vertical?.label || 'lead'}${lead.city ? ' in ' + lead.city : ''} (${lead.first_name})`;
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5b6967;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#14201f;max-width:620px">
<p style="margin:0 0 4px;color:#5b6967">${esc(site.brand)} · Tier ${esc(lead.tier)} · score ${esc(lead.score)}</p>
<h2 style="margin:0 0 12px">${esc(lead.first_name)} ${esc(lead.last_name)}</h2>
<p style="font-size:17px;margin:0 0 4px"><strong>📞 ${esc(lead.phone)}</strong></p>
<p style="margin:0 0 4px">✉ ${esc(lead.email)}</p>
<p style="margin:0 0 16px">📍 ${esc(where)}</p>
<p style="background:#fff3d9;padding:10px 12px;border-radius:8px;margin:0 0 16px"><strong>Call within 5 minutes if you can.</strong> Contact rates drop fast after that. They were told <strong>${esc(partner.consentName || partner.name)}</strong> would reach out.</p>
<table style="border-collapse:collapse;margin:0 0 16px">${table}</table>
<p style="font-size:13px;color:#5b6967;margin:0 0 6px"><strong>Consent</strong> (agreed ${esc(lead.consent_at)} from IP ${esc(lead.ip)}): ${esc(lead.consent_text)}</p>
<p style="font-size:13px;color:#5b6967">Honor any request to stop contact immediately. Bad number or duplicate? Request a replacement within 72 hours${portalUrl ? ` in <a href="${esc(portalUrl)}">your lead portal</a>` : ''}.</p>
</div>`;
  const text = [`${lead.first_name} ${lead.last_name} · ${lead.phone} · ${lead.email} · ${where}`, `Tier ${lead.tier} (${lead.score})`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', `Consent (${lead.consent_at}): ${lead.consent_text}`, portalUrl ? `Portal: ${portalUrl}` : ''].join('\n');
  return { subject, html, text };
}

/** The confirmation the consumer receives. Names exactly who will contact them. */
export function consumerEmail({ lead, contact, site }) {
  const who = contact?.company ? `${contact.name} of ${contact.company}` : (contact?.name || site.brand);
  const booking = contact?.bookingUrl || site.bookingUrl;
  const subject = `${site.brand}: we got your request, ${lead.first_name}`;
  const html = `<div style="font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#14201f;max-width:560px">
<p>Hi ${esc(lead.first_name)},</p>
<p>Thanks for your request on ${esc(site.brand)}. <strong>${esc(who)}</strong> will contact you shortly${contact?.phone ? ` from <strong>${esc(contact.phone)}</strong>` : ''}, so you'll know it's them.</p>
${booking ? `<p><a href="${esc(booking)}" style="display:inline-block;background:#0f3d3e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Pick a time that works for you</a></p>` : ''}
<p>There's no cost and no obligation. If you'd rather not be contacted, just reply to this email and say so.</p>
<p style="color:#5b6967;font-size:13px">${esc(site.brand)} · ${esc(site.operator?.name || '')} · ${esc(site.operator?.address || '')}</p>
</div>`;
  const text = `Hi ${lead.first_name},\n\nThanks for your request on ${site.brand}. ${who} will contact you shortly${contact?.phone ? ` from ${contact.phone}` : ''}.${booking ? `\n\nPick a time: ${booking}` : ''}\n\nNo cost, no obligation. Reply to this email if you'd rather not be contacted.\n\n${site.brand} · ${site.operator?.name || ''} · ${site.operator?.address || ''}`;
  return { subject, html, text };
}
