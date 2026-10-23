// astro.config.mjs
// One Astro project builds every ApexForge site. The SITE env var picks which
// sites/<slug>/site.json to load (scripts/build.mjs sets it for you).
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadSite } from './lib/core.mjs';

const { site } = loadSite(process.env.SITE);

export default defineConfig({
  site: `https://${site.domain}`,
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    // Keep utility pages out of the sitemap so crawl budget goes to money pages.
    sitemap({ filter: (url) => !/\/(thank-you|404)\//.test(url) })
  ],
  devToolbar: { enabled: false }
});
