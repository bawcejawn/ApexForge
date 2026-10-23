// src/lib/site.mjs
// Build-time access to the current site (selected by SITE env var).
import { marked } from 'marked';
import { loadSite, planPages, readContent, fill } from '../../lib/core.mjs';
import { pageMeta, templateBody } from '../../lib/content.mjs';

export const ctx = loadSite(process.env.SITE);
export const { site, vertical } = ctx;
export const pages = planPages(ctx);

export const vars = {
  ...ctx.vars,
  buyers: site.buyers.map(b => b.name).join(' or ')
};
export const t = (s) => fill(s, vars);

/** Content for a page: generated markdown if present, else template fallback. */
export function pageContent(page) {
  const meta = pageMeta(page, ctx);
  const c = readContent(ctx.dir, page.contentFile);
  const md = c?.body?.trim() ? c.body : templateBody(page, ctx);
  return {
    ...meta,
    ...(c?.data || {}),
    html: marked.parse(md)
  };
}

/** TCPA consent language, generated from the named buyer(s). Stored verbatim with each lead. */
export function consentText() {
  return `By checking this box and clicking "${vertical.cta}", I give my express written consent for ${vars.buyers} to contact me about ${vertical.label.toLowerCase()} at the phone number and email I provided, including by calls and text messages that may use automated technology or prerecorded/artificial voice. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out. I also agree to the Privacy Policy and Terms of Use.`;
}

export const abs = (p) => new URL(p, `https://${site.domain}`).href;
