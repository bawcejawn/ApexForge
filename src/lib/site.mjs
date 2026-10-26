// src/lib/site.mjs
// Build-time access to the current site (selected by SITE env var).
import { marked } from 'marked';
import { loadSite, planPages, readContent, fill } from '../../lib/core.mjs';
import { pageMeta, templateBody } from '../../lib/content.mjs';
import { loadPartners, consentName } from '../../lib/partners.mjs';
import { partnersForPage } from '../../lib/routing.mjs';

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

/** Partners shown on a page: those assigned to this site who cover that city. */
export const partnerDirectory = loadPartners();
export const pagePartners = (citySlug) =>
  partnersForPage({ assignments: site.partners || [], partners: partnerDirectory, citySlug });

/**
 * TCPA consent language. Stored verbatim with each lead, and the lead API only
 * routes a lead to a partner whose name appears in it.
 * Names: the site's own buyers (e.g. CPP Holdings LLC) plus every partner
 * covering this page's city ("Jane Smith of ABC Realty"). Topics come from
 * site.consentAbout so cross-offers are only made when the consumer agreed.
 */
export function consentText(citySlug) {
  const names = [...site.buyers.map(b => b.name), ...pagePartners(citySlug).map(consentName)];
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const about = site.consentAbout || vertical.label.toLowerCase();
  return `By checking this box and clicking "${vertical.cta}", I give my express written consent for ${who} to contact me about ${about} at the phone number and email I provided, including by calls and text messages that may use automated technology or prerecorded/artificial voice. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out. I also agree to the Privacy Policy and Terms of Use.`;
}

export const abs = (p) => new URL(p, `https://${site.domain}`).href;
