// robots.txt — allow crawling, point at the sitemap, keep the API out.
import type { APIRoute } from 'astro';
import { site } from '../lib/site.mjs';

export const GET: APIRoute = () => new Response(
  `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /thank-you/\nDisallow: /partner/\n\nSitemap: https://${site.domain}/sitemap-index.xml\n`,
  { headers: { 'content-type': 'text/plain' } }
);
