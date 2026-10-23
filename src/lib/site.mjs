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
  // Every named company is listed explicitly ("A and B"), and the topics come
  // from site.consentAbout when set (e.g. "real estate and mortgage protection
  // life insurance") so cross-offers are only made when the consumer agreed.
  const names = site.buyers.map(b => b.name);
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const about = site.consentAbout || vertical.label.toLowerCase();
  return `By checking this box and clicking "${vertical.cta}", I give my express written consent for ${who} to contact me about ${about} at the phone number and email I provided, including by calls and text messages that may use automated technology or prerecorded/artificial voice. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out. I also agree to the Privacy Policy and Terms of Use.`;
}

export const abs = (p) => new URL(p, `https://${site.domain}`).href;
