// admin/ui/app.js — ApexForge Admin views + hash router.
//   #/                     overview + launch checklists
//   #/sites                all sites, create new
//   #/site/<slug>/<tab>    tabs: overview | settings | pages | publish
//   #/page/<slug>/<file>   content editor for one page
//   #/leads                lead CRM
//   #/verticals            vertical list;  #/vertical/<id>  editor
//   #/jobs                 activity log;   #/settings  .env + Cloudflare
import { h, api, toast, act, fmtDate, money, pill, overlay, runJob, watchJob } from './lib.js';
import { createEditor } from './editor.js';
import { marked } from '/vendor/marked.js';

// Each screen renders into its own fresh container, which is only swapped in
// if no newer navigation started meanwhile (a slow screen can't overwrite a newer one).
const viewRoot = document.getElementById('view');
let currentView = viewRoot;  // set by render(); each screen captures it on entry
let renderSeq = 0;
const crumbs = document.getElementById('crumbs');
let dirty = false;                 // unsaved edits on the current screen
let cache = { verticals: [] };

// ------------------------------------------------------------------ router ---
const routes = [
  [/^#?\/?$/, overview, 'overview'],
  [/^#\/sites$/, sitesList, 'sites'],
  [/^#\/site\/([\w-]+)(?:\/(\w+))?$/, siteDetail, 'sites'],
  [/^#\/page\/([\w-]+)\/(.+)$/, pageEditor, 'sites'],
  [/^#\/leads$/, leadsView, 'leads'],
  [/^#\/verticals$/, verticalsList, 'verticals'],
  [/^#\/vertical\/([\w-]+)$/, verticalEditor, 'verticals'],
  [/^#\/jobs$/, jobsView, 'jobs'],
  [/^#\/partners$/, partnersList, 'partners'],
  [/^#\/partner\/([\w-]+)$/, partnerDetail, 'partners'],
  [/^#\/guides$/, guidesList, 'guides'],
  [/^#\/guide\/([\w-]+)$/, guideView, 'guides'],
  [/^#\/settings$/, settingsView, 'settings']
];
let lastHash = location.hash;

async function render() {
  if (dirty && !confirm('You have unsaved changes. Leave without saving?')) { history.replaceState(null, '', lastHash); return; }
  dirty = false;
  lastHash = location.hash;
  document.getElementById('side').classList.remove('open');
  const hash = location.hash || '#/';
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    const mine = ++renderSeq;
    viewRoot.replaceChildren(h('div.empty', 'Loading…'));
    const target = h('div');
    currentView = target;
    try { await fn(...m.slice(1).map(x => (x ? decodeURIComponent(x) : x))); }
    catch (e) { target.replaceChildren(h('div.notice.bad', e.message)); }
    if (mine !== renderSeq) return;   // the user already moved on
    viewRoot.replaceChildren(target);
    window.scrollTo(0, 0);
    return;
  }
  viewRoot.replaceChildren(h('div.empty', 'Page not found. ', h('a', { href: '#/' }, 'Go to overview')));
}
window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
const setCrumbs = (...items) => crumbs.replaceChildren(...items.flatMap((it, i) => [i ? ' / ' : '', typeof it === 'string' ? it : h('a', { href: it[1] }, it[0])]));
const head = (title, sub, ...actions) => h('div.head', h('div', h('h1', title), sub && h('p.muted', { style: { margin: 0 } }, sub)), h('div.row', actions));

async function verticalIds() {
  if (!cache.verticals.length) cache.verticals = (await api('/api/verticals')).map(v => v.id);
  return cache.verticals;
}

// ---------------------------------------------------------------- overview ---
async function overview() {
  const view = currentView;
  setCrumbs('Overview');
  const o = await api('/api/overview');
  const ready = o.sites.filter(s => s.ready).length;
  const setup = [
    { ok: o.ai.ollama.reachable || o.ai.fallbacks.length > 0, label: 'AI writer available', detail: o.ai.ollama.reachable ? `Ollama running (${o.ai.ollama.models.length} models)` : o.ai.fallbacks.length ? `Using ${o.ai.fallbacks.join(', ')}` : 'Start Ollama or add a free API key in Settings (templates are used until then)', href: '#/settings' },
    { ok: o.wranglerDbConfigured, label: 'Lead database created on Cloudflare', detail: 'Settings → Cloudflare → Log in, then Create database', href: '#/settings' },
    { ok: o.env.adminToken, label: 'Admin token set', detail: 'Settings → Leads → generate one, and set the same value in Cloudflare', href: '#/settings' },
    { ok: o.env.leadApis, label: 'Live site URLs listed for lead pulling', detail: 'Settings → Leads → LEAD_APIS', href: '#/settings' },
    { ok: o.sites.length > 0, label: 'At least one site created', href: '#/sites' }
  ];

  view.replaceChildren(
    head('Overview', 'Everything ApexForge is running, and what still needs doing.',
      h('a.btn', { href: '#/sites' }, '+ New site'),
      h('button.btn.primary', { onclick: (e) => act(e.target, () => runJob('leads', {}, { onDone: () => render() })) }, 'Pull leads')),
    h('div.grid',
      stat(o.sites.length, 'Sites', `${ready} launch-ready`),
      stat(o.leads.total, 'Leads captured', o.leads.lastPull ? `Last pull ${fmtDate(o.leads.lastPull)}` : 'Not pulled yet'),
      stat(money(o.leads.revenue), 'Sold revenue', `${o.leads.byStatus.sold || 0} sold`),
      stat(`${o.leads.byTier.A || 0} / ${o.leads.byTier.B || 0} / ${o.leads.byTier.C || 0}`, 'Tier A / B / C', 'Lead quality mix')
    ),
    h('div.section.grid.two',
      h('div.card', h('h2', 'Setup'), checklist(setup)),
      h('div.card', h('h2', 'Sites'),
        o.sites.length ? h('div', o.sites.map(s => h('div', { style: { padding: '8px 0', borderBottom: '1px dashed var(--line)' } },
          h('div.row', h('a', { href: `#/site/${s.slug}` }, h('strong', s.brand || s.slug)), s.error ? pill('error', 'bad') : s.ready ? pill('ready', 'ok') : pill(`${s.checklist.filter(c => !c.ok).length} to do`, 'warn'), h('span.muted.small', s.vertical)),
          !s.error && h('div.muted.small', `${s.pages} pages · ${s.reviewed} reviewed · ${s.flagged} flagged · ${s.built ? 'built ' + fmtDate(s.built) : 'not built'}`)
        ))) : h('p.muted', 'No sites yet. ', h('a', { href: '#/sites' }, 'Create your first one.'))
      )
    )
  );
}
const stat = (num, lbl, sub) => h('div.card.stat', h('div.num', num), h('div.lbl', lbl), sub && h('div.muted.small', sub));
const checklist = (items) => h('ul.check', items.map(c => h('li', { class: c.ok ? 'ok' : 'no' },
  h('span.dot', c.ok ? '✓' : '!'),
  h('span', c.href && !c.ok ? h('a', { href: c.href }, c.label) : c.label, !c.ok && c.detail && h('span.detail', c.detail), c.ok && c.detail && c.id === 'built' && h('span.detail', fmtDate(c.detail))))));

// ------------------------------------------------------------------- sites ---
async function sitesList() {
  const view = currentView;
  setCrumbs('Sites');
  const [sites, verts] = await Promise.all([api('/api/sites'), verticalIds()]);
  view.replaceChildren(
    head('Sites', 'Each site is one domain, one vertical, and a set of cities.', h('button.btn.primary', { onclick: () => newSiteModal(verts) }, '+ New site')),
    sites.length ? h('div.table-wrap', h('table',
      h('thead', h('tr', ['Site', 'Vertical', 'Cities', 'Pages', 'Reviewed', 'Status', 'Built'].map(t => h('th', t)))),
      h('tbody', sites.map(s => h('tr.click', { onclick: () => (location.hash = `#/site/${s.slug}`) },
        h('td', h('strong', s.brand || s.slug), h('div.muted.small', s.domain)),
        h('td', s.vertical), h('td', s.cities), h('td', s.pages),
        h('td', `${s.reviewed}/${s.pages}`),
        h('td', s.error ? pill('error', 'bad') : s.ready ? pill('ready', 'ok') : pill(`${s.checklist.filter(c => !c.ok).length} to do`, 'warn')),
        h('td.muted', s.built ? fmtDate(s.built) : '—')
      )))
    )) : h('div.card.empty', 'No sites yet.')
  );
}

function newSiteModal(verts) {
  const f = (name, label, attrs = {}, hint) => h('label.f', h('span', label), h('input', { name, type: 'text', ...attrs }), hint && h('span.hint', hint));
  const form = h('form',
    h('h2', 'New site'),
    h('label.f', h('span', 'Vertical'), h('select', { name: 'vertical' }, verts.map(v => h('option', { value: v }, v)))),
    f('brand', 'Brand name', { required: true, placeholder: 'Hill Country Life Quotes' }),
    f('domain', 'Domain', { placeholder: 'hillcountrylifequotes.com' }, 'Optional now. Also becomes the folder and Cloudflare project name.'),
    h('div.ed-cols', f('state', 'State (2 letters)', { placeholder: 'TX', maxlength: 2 }), f('stateName', 'State name', { placeholder: 'Texas' })),
    f('cities', 'Cities', { placeholder: 'Austin, Round Rock, Georgetown' }, 'Comma-separated. You can add local facts per city later.'),
    f('email', 'Lead / contact email', { type: 'email' }),
    f('legalName', 'Legal business name', { placeholder: 'Your LLC' }),
    f('address', 'Business address'),
    f('buyer', 'Buyer named in consent', { placeholder: 'Example Agency LLC|TX License #0000000' }, 'The one company that may contact these leads. "Name|License". Use your own business if you call leads yourself.'),
    h('div.row', { style: { marginTop: '8px' } },
      h('button.btn.primary', { type: 'submit' }, 'Create site'),
      h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel'))
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    b.state = b.state.toUpperCase();
    b.buyer = b.buyer ? [b.buyer] : [];
    const r = await act(form.querySelector('[type=submit]'), () => api('/api/sites', { method: 'POST', body: b }), 'Site created');
    close();
    location.hash = `#/site/${r.slug}/overview`;
  };
  const close = overlay(h('div.modal', form), { center: true });
}

async function siteDetail(slug, tab = 'overview') {
  const view = currentView;
  const { site, status } = await api(`/api/sites/${slug}`);
  setCrumbs(['Sites', '#/sites'], site.brand);
  const tabs = h('nav.tabs', [['overview', 'Overview'], ['settings', 'Settings'], ['pages', 'Pages & content'], ['publish', 'Build & publish']]
    .map(([id, label]) => h('a', { href: `#/site/${slug}/${id}`, class: tab === id ? 'active' : '' }, label)));
  const body = h('div');
  view.replaceChildren(head(site.brand, `${site.domain} · ${site.vertical} · ${site.cities.length} cities`,
    h('button.btn', { onclick: (e) => act(e.target, () => runJob('preview', { site: slug })) }, 'Preview'),
    h('button.btn.primary', { onclick: (e) => act(e.target, () => runJob('build', { site: slug }, { onDone: () => tab === 'overview' && render() })) }, 'Build')),
    tabs, body);
  await ({ overview: siteOverviewTab, settings: siteSettingsTab, pages: sitePagesTab, publish: sitePublishTab }[tab] || siteOverviewTab)(body, slug, site, status);
}

function siteOverviewTab(body, slug, site, status) {
  body.append(h('div.grid.two',
    h('div.card', h('h2', 'Launch checklist'), checklist(status.checklist.map(c => ({ ...c, href: { todos: `#/site/${slug}/settings`, buyers: `#/site/${slug}/settings`, author: `#/site/${slug}/settings`, notes: `#/site/${slug}/settings`, content: `#/site/${slug}/pages`, reviewed: `#/site/${slug}/pages`, flags: `#/site/${slug}/pages`, built: `#/site/${slug}/publish` }[c.id] })))),
    h('div',
      h('div.card', h('h2', 'Quick actions'),
        h('div.row',
          h('button.btn', { onclick: (e) => act(e.target, () => runJob('content', { site: slug }, { onDone: () => render() })) }, 'Write missing pages'),
          h('a.btn', { href: `#/site/${slug}/pages` }, 'Review pages'),
          h('a.btn', { href: `#/site/${slug}/settings` }, 'Edit settings'),
          h('a.btn', { href: `#/site/${slug}/publish` }, 'Publish'))),
      h('div.card', h('h2', 'Content'),
        h('div.grid', stat(status.pages, 'Pages'), stat(status.ai, 'AI-written'), stat(status.reviewed, 'Reviewed'), stat(status.flagged, 'Flagged'))))
  ));
}

async function siteSettingsTab(body, slug, site) {
  const verts = await verticalIds();
  const ed = createEditor(site, {
    _comment: { hidden: true },
    partners: { hidden: true },
    turnstileSiteKey: { label: 'Bot check site key (Turnstile)', hint: 'Optional, free. From Cloudflare → Turnstile → Add widget. The matching secret goes in Cloudflare as TURNSTILE_SECRET. See Guides → Go live.' },
    slug: { readonly: true, hint: 'Folder and Cloudflare project name. Fixed after creation.' },
    vertical: { widget: 'select', options: verts, hint: 'Changing this changes every page, the form and scoring. Regenerate content afterwards.' },
    brand: { hint: 'Shown in the header, titles and consent text.' },
    domain: { hint: 'Your custom domain, without https://' },
    state: { hint: 'Two-letter code, e.g. TX' },
    bookingUrl: { label: 'Booking link', placeholder: 'https://cal.com/yourname/quote-call', hint: 'Optional but recommended. A free Cal.com or Google Calendar appointment link. After submitting the form, leads pick a call time that fits your schedule.' },
    consentAbout: { label: 'Consent covers', widget: 'textarea', rows: 2, hint: 'What the named companies may contact the lead about. Shown word-for-word in the consent box. Only offer things listed here.' },
    maxCityPages: { label: 'Max city pages', hint: 'Cap per service. Start with 20–50 total pages per site; grow once indexed.' },
    cities: { itemLabel: 'city', template: { name: '', slug: '', localNotes: '' }, hint: 'Each city becomes one page per service. Slug fills in automatically from the name if left blank.' },
    'cities.*.localNotes': { widget: 'textarea', label: 'Local facts', hint: 'Verified facts about this city (major employers, housing, retirement communities, hospitals). The AI must use these and is told not to invent others. This is what makes city pages genuinely useful.', rows: 3 },
    'cities.*.slug': { hint: 'Leave blank to auto-generate' },
    operator: { label: 'Your business', hint: 'Appears in the footer, privacy policy and terms. Must be real before launch.' },
    buyers: { itemLabel: 'buyer', template: { name: '', license: '' }, hint: 'The company(ies) named in the consent text. Sell each lead only to a company named here when the lead was captured.' },
    author: { label: 'Content reviewer', hint: 'A real person who reviews pages. Shown on reviewed pages and the About page (E-E-A-T signal).' },
    'author.bio': { widget: 'textarea' },
    'theme.primary': { widget: 'color' }, 'theme.accent': { widget: 'color' },
    analytics: { hint: 'Optional free Cloudflare Web Analytics token (no cookies).' }
  }, { onChange: () => { dirty = true; saveBtn.disabled = false; } });
  const saveBtn = h('button.btn.primary', { disabled: true, onclick: async (e) => {
    await act(e.target, () => api(`/api/sites/${slug}`, { method: 'PUT', body: ed.getValue() }), 'Saved');
    dirty = false; e.target.disabled = true;
  } }, 'Save changes');
  const delBtn = h('button.btn.danger', { onclick: async (e) => {
    if (!confirm(`Move "${site.brand}" to the trash folder? (.trash/ in the project — nothing is permanently deleted)`)) return;
    await act(e.target, () => api(`/api/sites/${slug}`, { method: 'DELETE' }), 'Moved to .trash/');
    dirty = false; location.hash = '#/sites';
  } }, 'Delete site');
  body.append(ed.el, h('div.sticky-bar', saveBtn, h('span.muted.small', 'Changes apply on the next build.'), h('span', { style: { marginLeft: 'auto' } }), delBtn));
}

async function sitePagesTab(body, slug) {
  const pages = await api(`/api/sites/${slug}/pages`);
  const q = h('input', { type: 'search', placeholder: 'Filter by URL, service or city…' });
  const sel = h('select', h('option', { value: '' }, 'All pages'), h('option', { value: 'unreviewed' }, 'Not reviewed'), h('option', { value: 'flagged' }, 'Flagged'), h('option', { value: 'missing' }, 'Not written'), h('option', { value: 'template' }, 'Template text'));
  const tbody = h('tbody');
  const draw = () => {
    const t = q.value.toLowerCase();
    tbody.replaceChildren(...pages.filter(p =>
      (!t || [p.url, p.service, p.city].join(' ').toLowerCase().includes(t)) &&
      (!sel.value || (sel.value === 'unreviewed' && p.exists && !p.reviewed) || (sel.value === 'flagged' && p.flags.length) || (sel.value === 'missing' && !p.exists) || (sel.value === 'template' && p.source === 'template'))
    ).map(p => h('tr.click', { onclick: () => (location.hash = `#/page/${slug}/${encodeURIComponent(p.file)}`) },
      h('td', h('span.mono', p.url), p.title && h('div.muted.small', p.title)),
      h('td', p.kind),
      h('td', p.exists ? (p.source === 'template' ? pill('template') : pill(p.source.split(':')[0], 'info')) : pill('missing', 'bad')),
      h('td', p.words || '—'),
      h('td', p.flags.length ? pill(p.flags.join(', '), 'bad') : ''),
      h('td', p.reviewed ? pill('reviewed', 'ok') : p.exists ? pill('to review', 'warn') : '')
    )));
  };
  q.oninput = draw; sel.onchange = draw;
  body.append(
    h('div.filters', q, sel,
      h('button.btn', { onclick: (e) => act(e.target, () => runJob('content', { site: slug }, { onDone: () => render() })) }, 'Write missing pages'),
      h('button.btn', { title: 'Rewrites only pages that still use template text. Pages you or the AI already wrote are kept.', onclick: (e) => act(e.target, () => runJob('content', { site: slug, upgrade: true }, { onDone: () => render() })) }, 'Upgrade template pages with AI'),
      h('button.btn', { onclick: (e) => confirm('Regenerate EVERY page? This overwrites your edits on this site.') && act(e.target, () => runJob('content', { site: slug, overwrite: true }, { onDone: () => render() })) }, 'Regenerate all'),
      h('button.btn', { onclick: async (e) => { if (!confirm('Mark every page as reviewed? Only do this after you have actually read them.')) return; await act(e.target, () => api(`/api/sites/${slug}/review-all`, { method: 'POST', body: { reviewed: true } }), 'All pages marked reviewed'); render(); } }, 'Mark all reviewed')),
    h('div.table-wrap', h('table', h('thead', h('tr', ['Page', 'Type', 'Source', 'Words', 'Flags', 'Review'].map(t => h('th', t)))), tbody))
  );
  draw();
}

function sitePublishTab(body, slug, site, status) {
  const step = (n, title, desc, ...btns) => h('div.card', h('h3', `${n}. ${title}`), h('p.muted.small', desc), h('div.row', btns));
  body.append(
    status.ready ? h('div.notice', 'Launch checklist complete. Build and deploy when ready.')
      : h('div.notice.warn', `${status.checklist.filter(c => !c.ok).length} launch checklist item(s) open. You can still build and preview, but fix them before pointing a real domain here.`),
    step(1, 'Build', 'Turns config + content into static HTML in dist/' + slug + '/.',
      h('button.btn.primary', { onclick: (e) => act(e.target, () => runJob('build', { site: slug })) }, 'Build'),
      h('button.btn', { onclick: (e) => act(e.target, () => runJob('forge', { site: slug })) }, 'Write missing pages + build')),
    step(2, 'Preview', 'Starts a local preview at http://localhost:4321 so you can click through the real site. Stop it from the activity panel.',
      h('button.btn', { onclick: (e) => act(e.target, () => runJob('preview', { site: slug })) }, 'Start preview'),
      h('a.btn', { href: 'http://localhost:4321', target: '_blank', rel: 'noopener' }, 'Open localhost:4321 ↗')),
    step(3, 'Deploy to Cloudflare Pages', 'Uploads the build plus the lead API. Requires the Cloudflare login and database from Settings. The first deploy creates the project "' + slug + '".',
      h('button.btn.primary', { onclick: (e) => act(e.target, () => runJob('deploy', { site: slug })) }, 'Deploy'),
      h('a.btn', { href: '#/settings' }, 'Cloudflare settings')),
    h('div.card', h('h3', '4. One-time Cloudflare dashboard steps (per site)'),
      h('ol.small', { style: { paddingLeft: '18px', margin: 0 } },
        h('li', 'Workers & Pages → ', h('strong', slug), ' → Settings → Bindings → add D1 database, variable name ', h('code', 'DB'), ', database ', h('code', 'apexforge-leads'), '.'),
        h('li', 'Settings → Variables and secrets → add ', h('code', 'ADMIN_TOKEN'), ' (same value as in this app\'s Settings). Optional: ', h('code', 'NOTIFY_WEBHOOK'), ' (Discord/Slack webhook for instant alerts).'),
        h('li', 'Custom domains → add ', h('strong', site.domain), '. Then deploy again.'),
        h('li', 'Add ', h('code', `https://${site.domain}`), ' to LEAD_APIS in Settings so leads can be pulled here.'),
        h('li', 'Submit ', h('code', `https://${site.domain}/sitemap-index.xml`), ' in Google Search Console and Bing Webmaster Tools.')))
  );
}

// ------------------------------------------------------------ page editor ---
async function pageEditor(slug, file) {
  const view = currentView;
  const [{ site }, page, pages] = await Promise.all([
    api(`/api/sites/${slug}`), api(`/api/sites/${slug}/content?file=${encodeURIComponent(file)}`), api(`/api/sites/${slug}/pages`)
  ]);
  const meta = pages.find(p => p.file === file);
  const idx = pages.findIndex(p => p.file === file);
  setCrumbs(['Sites', '#/sites'], [site.brand, `#/site/${slug}/pages`], meta.url);
  const d = { title: '', description: '', h1: '', ...page.data };
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  const titleIn = h('input', { type: 'text', value: d.title, oninput: (e) => { d.title = e.target.value; tCount.textContent = `${d.title.length}/60`; mark(); } });
  const tCount = h('span.hint', `${d.title.length}/60`);
  const descIn = h('textarea', { rows: 2, value: d.description, oninput: (e) => { d.description = e.target.value; dCount.textContent = `${d.description.length}/155`; mark(); } });
  const dCount = h('span.hint', `${d.description.length}/155`);
  const h1In = h('input', { type: 'text', value: d.h1, oninput: (e) => { d.h1 = e.target.value; mark(); } });
  const md = h('textarea.md', { value: page.body, oninput: () => { mark(); schedulePreview(); } });
  const frame = h('iframe.preview', { sandbox: '', title: 'Preview' });   // sandbox: no scripts run in previews
  const flags = h('div');
  const reviewed = h('input', { type: 'checkbox', checked: d.reviewed === 'true', onchange: mark });
  let t;
  const schedulePreview = () => { clearTimeout(t); t = setTimeout(preview, 250); };
  const preview = () => {
    frame.srcdoc = `<!doctype html><meta charset=utf-8><style>body{font:16px/1.6 system-ui,sans-serif;color:#14201f;padding:8px 18px;max-width:70ch}h2{font-size:1.3rem;margin-top:1.5em}</style><h1 style="font-size:1.7rem">${esc(d.h1)}</h1>${marked.parse(md.value)}`;
  };
  const showFlags = (list) => flags.replaceChildren(list.length ? h('div.notice.bad', h('strong', 'Compliance flags: '), list.join(', '), h('div.small', 'Rewrite these phrases. Specific prices, rates, guarantees and approval claims create legal risk.')) : '');
  showFlags(page.flags);
  const save = async (andNext) => {
    const r = await act(saveBtn, () => api(`/api/sites/${slug}/content?file=${encodeURIComponent(file)}`, {
      method: 'PUT', body: { data: { ...d, reviewed: reviewed.checked ? 'true' : 'false' }, body: md.value }
    }), 'Page saved');
    dirty = false; saveBtn.disabled = true; showFlags(r.flags);
    if (andNext && pages[idx + 1]) location.hash = `#/page/${slug}/${encodeURIComponent(pages[idx + 1].file)}`;
  };
  const saveBtn = h('button.btn.primary', { disabled: true, onclick: () => save(false) }, 'Save');
  const nav = (i) => pages[i] && h('a.btn', { href: `#/page/${slug}/${encodeURIComponent(pages[i].file)}` }, i < idx ? '← Previous' : 'Next →');

  view.replaceChildren(
    head(meta.url, `${meta.kind} page${meta.service ? ' · ' + meta.service : ''}${meta.city ? ' · ' + meta.city : ''} · source: ${d.source || 'not written yet'}`, nav(idx - 1), nav(idx + 1)),
    !page.exists && h('div.notice.warn', 'This page has no saved content yet; the site uses template text. Write it here or run "Write missing pages".'),
    flags,
    h('div.card',
      h('label.f', h('span', 'SEO title'), titleIn, tCount),
      h('label.f', h('span', 'Meta description'), descIn, dCount),
      h('label.f', h('span', 'Page heading (H1)'), h1In)),
    h('div.section.editor-grid',
      h('div', h('div.f-label', 'Body (Markdown) ', h('span.hint', 'Use ## for section headings. FAQs and the form are added automatically.')), md),
      h('div', h('div.f-label', 'Preview'), frame)),
    h('div.sticky-bar',
      h('label', reviewed, ' I read and checked this page (reviewed)'),
      h('span', { style: { marginLeft: 'auto' } }), saveBtn,
      h('button.btn', { onclick: () => save(true), disabled: !pages[idx + 1] }, 'Save & next'))
  );
  preview();
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------- leads ---
const STATUSES = ['new', 'contacted', 'qualified', 'sold', 'return_requested', 'returned', 'dnc', 'bad'];
const statusKind = { new: 'info', contacted: '', qualified: 'info', sold: 'ok', return_requested: 'warn', returned: 'warn', dnc: 'bad', bad: 'bad' };

async function leadsView() {
  const view = currentView;
  setCrumbs('Leads');
  const { leads, lastPull } = await api('/api/leads');
  const sites = [...new Set(leads.map(l => l.site))];
  const q = h('input', { type: 'search', placeholder: 'Search name, phone, email, ZIP, city…' });
  const fSite = h('select', h('option', { value: '' }, 'All sites'), sites.map(s => h('option', { value: s }, s)));
  const fTier = h('select', h('option', { value: '' }, 'All tiers'), ['A', 'B', 'C'].map(t => h('option', { value: t }, `Tier ${t}`)));
  const fStatus = h('select', h('option', { value: '' }, 'All statuses'), STATUSES.map(s => h('option', { value: s }, s)));
  const tbody = h('tbody');
  const count = h('span.muted.small');
  const filtered = () => {
    const t = q.value.toLowerCase().replace(/[^\w@.\s]/g, '');
    return leads.filter(l =>
      (!fSite.value || l.site === fSite.value) && (!fTier.value || l.tier === fTier.value) && (!fStatus.value || l.status === fStatus.value) &&
      (!t || [l.first_name, l.last_name, l.phone, l.email, l.zip, l.city, l.service].join(' ').toLowerCase().replace(/[^\w@.\s]/g, '').includes(t)));
  };
  const draw = () => {
    const rows = filtered();
    count.textContent = `${rows.length} of ${leads.length}`;
    tbody.replaceChildren(...rows.map(l => h('tr.click', { onclick: () => leadDrawer(l, draw) },
      h('td.muted.small', fmtDate(l.created_at)),
      h('td', h('strong', `${l.first_name || ''} ${l.last_name || ''}`), h('div.muted.small', l.site)),
      h('td.mono', l.phone),
      h('td', l.service || '—', h('div.muted.small', [l.city, l.zip].filter(Boolean).join(' · '))),
      h('td', h('span.pill', { class: `tier-${l.tier}` }, `${l.tier} · ${l.score}`)),
      h('td', pill(l.status, statusKind[l.status]), l._unsynced && h('div', pill('not synced', 'warn'))),
      h('td', l.buyer || '—', l.sold_price ? h('div.muted.small', money(l.sold_price)) : '')
    )));
  };
  [q, fSite, fTier, fStatus].forEach(el => el.addEventListener(el === q ? 'input' : 'change', draw));
  const csv = () => {
    const cols = ['created_at', 'site', 'service', 'first_name', 'last_name', 'phone', 'email', 'zip', 'city', 'tier', 'score', 'status', 'buyer', 'sold_price', 'id'];
    const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s) && !/^[+-]?\d/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const blob = new Blob([[cols.join(','), ...filtered().map(l => cols.map(c => cell(l[c])).join(','))].join('\n')], { type: 'text/csv' });
    h('a', { href: URL.createObjectURL(blob), download: `leads-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  };
  const last = Object.values(lastPull).sort().at(-1);
  view.replaceChildren(
    head('Leads', last ? `Last pulled ${fmtDate(last)}` : 'Pull leads from your live sites to work them here.',
      h('button.btn', { onclick: csv }, 'Export CSV (filtered)'),
      h('button.btn.primary', { onclick: (e) => act(e.target, () => runJob('leads', {}, { onDone: () => render() })) }, 'Pull new leads')),
    h('div.filters', q, fSite, fTier, fStatus, count),
    leads.length ? h('div.table-wrap', h('table', h('thead', h('tr', ['Received', 'Name', 'Phone', 'Interest', 'Tier', 'Status', 'Buyer'].map(t => h('th', t)))), tbody))
      : h('div.card.empty', 'No leads yet. Once a site is live and LEAD_APIS + ADMIN_TOKEN are set in Settings, click "Pull new leads".')
  );
  draw();
}

// ------------------------------------------------------------ quote sheet ---
// Turns a lead's answers into a call-ready summary: labeled answers in form
// order, age and BMI, a rough underwriting read, and the call checklist.
const verticalCache = {};
async function getVertical(id) {
  if (!verticalCache[id]) verticalCache[id] = await api(`/api/verticals/${id}`).catch(() => null);
  return verticalCache[id];
}
function ageOf(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!m) return null;
  const n = new Date(); let a = n.getFullYear() - +m[1];
  if (n.getMonth() + 1 < +m[2] || (n.getMonth() + 1 === +m[2] && n.getDate() < +m[3])) a--;
  return a;
}
function quoteSheet(l, v, answers) {
  const fields = v ? v.form.steps.flatMap(s => s.fields) : [];
  const label = (k) => fields.find(f => f.name === k)?.label?.replace(/ /g, '').trim() || k.replace(/_/g, ' ');
  const svcName = (slug) => v?.services.find(s => s.slug === slug)?.name || slug;
  const show = (k, val) => (Array.isArray(val) ? val.join(', ') : k === 'service' ? svcName(val) : String(val));
  const rows = [];
  const age = ageOf(answers.dob);
  if (age !== null) rows.push(['Age', `${age} (DOB ${answers.dob})`]);
  if (answers.height_ft) {
    const inches = Number(answers.height_ft) * 12 + Number(answers.height_in || 0);
    const bmi = inches && answers.weight ? (703 * Number(answers.weight) / (inches * inches)).toFixed(1) : null;
    rows.push(['Build', `${answers.height_ft}'${answers.height_in || 0}" · ${answers.weight || '?'} lbs${bmi ? ` · BMI ${bmi}` : ''}`]);
  }
  const skip = new Set(['dob', 'height_ft', 'height_in', 'weight']);
  const ordered = [...fields.map(f => f.name).filter(k => k in answers), ...Object.keys(answers).filter(k => !fields.some(f => f.name === k))];
  for (const k of ordered) if (!skip.has(k) && answers[k] !== '' && answers[k] != null && !(Array.isArray(answers[k]) && !answers[k].length)) rows.push([label(k), show(k, answers[k])]);
  if (l.service && !('service' in answers)) rows.unshift(['Coverage type', svcName(l.service)]);

  // Underwriting triage (life only)
  let triage = null;
  const uw = v?.underwriting;
  if (uw) {
    const c = Array.isArray(answers.conditions) ? answers.conditions : [];
    const hit = (list) => c.filter(x => (list || []).includes(x));
    const gi = hit(uw.guaranteedIssue), gr = hit(uw.graded), wa = hit(uw.watch);
    const tob = answers.tobacco && !/^(Never|Quit more)/.test(answers.tobacco);
    triage = gi.length ? ['bad', 'Guaranteed-issue likely', gi.join(', ')]
      : gr.length ? ['warn', 'Graded / modified likely (some carriers may offer level)', gr.join(', ')]
      : wa.length ? ['info', 'Level / standard possible with the right carrier', wa.join(', ')]
      : c.includes('None of these') ? ['ok', 'Preferred / level likely', 'No listed conditions']
      : ['', 'Health not answered', ''];
    if (tob) triage[2] = [triage[2], 'tobacco/nicotine rates'].filter(Boolean).join(' · ');
    if (age !== null && age > 85) triage = ['bad', 'Over most carriers\' issue ages (85)', triage[2]];
  }
  const text = [`${l.first_name} ${l.last_name} · ${l.phone} · ${l.email} · ZIP ${l.zip}${l.city ? ' (' + l.city + ')' : ''}`,
    ...rows.map(([k, val]) => `${k}: ${val}`), triage ? `Underwriting read: ${triage[1]}${triage[2] ? ' (' + triage[2] + ')' : ''}` : ''].filter(Boolean).join('\n');
  const copy = h('button.btn.sm', { onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Quote sheet copied'); } catch { toast('Copy failed — select the text instead', 'bad'); } } }, 'Copy');
  return h('div',
    h('div.card', h('div.row', h('h3', { style: { margin: 0 } }, 'Quote sheet'), h('span', { style: { marginLeft: 'auto' } }), copy),
      triage && h('p', pill(triage[1], triage[0]), triage[2] && h('span.muted.small', ' ', triage[2])),
      h('dl.kv', rows.map(([k, val]) => [h('dt', k), h('dd', val)])),
      triage && h('p.muted.small', 'Rough guide only. Carrier underwriting rules differ; check your carrier guides before quoting.')),
    v?.callChecklist?.length > 0 && h('div.card', h('h3', 'Still to gather on the call'),
      h('ul.check', v.callChecklist.map(item => h('li', h('input', { type: 'checkbox' }), h('span', item))))));
}

async function leadDrawer(l, redraw) {
  const v = await getVertical(l.vertical);
  let answers = {};
  try { answers = JSON.parse(l.answers_json || l.answers || '{}'); } catch {}
  let utm = {};
  try { utm = JSON.parse(l.utm_json || '{}'); } catch {}
  const status = h('select', STATUSES.map(s => h('option', { value: s, selected: s === l.status }, s)));
  const buyer = h('input', { type: 'text', value: l.buyer || '', placeholder: 'Who bought / was routed this lead' });
  const price = h('input', { type: 'number', step: 'any', value: l.sold_price ?? '', placeholder: l.suggested_price ? `Suggested ${money(l.suggested_price)}` : '' });
  const notes = h('textarea', { rows: 3, value: l.notes || '' });
  const kv = (obj) => h('dl.kv', Object.entries(obj).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [h('dt', k.replace(/_/g, ' ')), h('dd', String(v))]));
  const save = h('button.btn.primary', { onclick: async (e) => {
    const r = await act(e.target, () => api(`/api/leads/${l.id}`, { method: 'PATCH', body: { status: status.value, buyer: buyer.value, sold_price: price.value, notes: notes.value } }));
    Object.assign(l, r.lead);
    toast(r.synced ? 'Saved and synced to the live site' : `Saved locally. ${r.syncError || ''}`, r.synced ? '' : 'bad');
    redraw(); close();
  } }, 'Save');
  const decide = (newStatus, msg) => async (e) => {
    const r = await act(e.target, () => api(`/api/leads/${l.id}`, { method: 'PATCH', body: { status: newStatus } }));
    Object.assign(l, r.lead);
    toast(r.synced ? msg : `Saved locally. ${r.syncError || ''}`, r.synced ? '' : 'bad');
    redraw(); close();
  };
  let routeLog = [];
  try { routeLog = JSON.parse(l.route_log || '[]'); } catch {}
  const returnBox = l.status === 'return_requested' && h('div.notice.warn',
    h('strong', `${l.buyer || 'The partner'} asked for a replacement.`), h('div.small', (l.notes || '').split('\n').at(-1)),
    h('div.row', { style: { marginTop: '8px' } },
      h('button.btn.sm.primary', { onclick: decide('returned', 'Return approved: their balance is credited back') }, 'Approve (credit them)'),
      h('button.btn.sm', { onclick: decide('sold', 'Return rejected: lead stays sold') }, 'Reject')));
  const routing = (l.partner_id || routeLog.length) && h('div.card', h('h3', 'Routing'),
    h('p.small', l.partner_id ? `Delivered to ${l.buyer} on ${fmtDate(l.delivered_at)} for ${money(l.sold_price)}.` : 'Kept for you: no partner was eligible.'),
    routeLog.length > 0 && h('ul.small', routeLog.map(r => h('li', `${r.id}: ${r.reason}`))));
  const close = overlay(h('div.drawer',
    h('div.row', h('h2', { style: { margin: 0 } }, `${l.first_name || ''} ${l.last_name || ''}`), h('span.pill', { class: `tier-${l.tier}` }, `Tier ${l.tier} · ${l.score}`), h('button.icon-btn', { style: { marginLeft: 'auto' }, onclick: () => close() }, '×')),
    h('p', h('a.btn', { href: `tel:${l.phone}` }, '📞 ', l.phone), ' ', l.email && h('a.btn', { href: `mailto:${l.email}` }, '✉ ', l.email)),
    returnBox,
    routing,
    h('div.card', h('h3', 'Work this lead'),
      h('label.f', h('span', 'Status'), status),
      h('label.f', h('span', 'Buyer'), buyer, h('span.hint', 'Only pass a lead to a company named in its consent (below), or to a partner the lead agreed to on your call. Record that OK in Notes.')),
      h('label.f', h('span', 'Sold price ($)'), price),
      h('label.f', h('span', 'Notes'), notes),
      save),
    h('div.card', h('h3', 'Details'), kv({ site: l.site, service: l.service, city: l.city, zip: l.zip, received: fmtDate(l.created_at), duplicate_of: l.duplicate_of, suggested_price: l.suggested_price && money(l.suggested_price), bot_check: l.bot_check })),
    quoteSheet(l, v, answers),
    h('p', h('a.btn.sm', { href: `#/guide/call-scripts`, onclick: () => close() }, 'Open call scripts')),
    h('div.card', h('h3', 'Consent proof'), h('p.small', l.consent_text || '(consent text not pulled)'),
      kv({ consented_at: l.consent_at, ip: l.ip, page: l.page_url, referrer: l.referrer, time_on_page_s: l.time_on_page_s, consent_hash: l.consent_hash, ...utm }))
  ));
}

// --------------------------------------------------------------- verticals ---
async function verticalsList() {
  const view = currentView;
  setCrumbs('Verticals');
  const verts = await api('/api/verticals');
  cache.verticals = verts.map(v => v.id);
  view.replaceChildren(
    head('Verticals', 'A vertical defines services (page types), the lead form, lead scoring and compliance rules. Sites pick one.',
      h('button.btn.primary', { onclick: () => newVerticalModal(verts) }, '+ New vertical')),
    h('div.grid', verts.map(v => h('a.card', { href: `#/vertical/${v.id}`, style: { textDecoration: 'none', color: 'inherit' } },
      h('h2', v.label), h('p.muted.small', `${v.services} services · used by ${v.sites} site(s)`), h('span.mono.muted', v.id))))
  );
}

function newVerticalModal(verts) {
  const form = h('form', h('h2', 'New vertical'),
    h('label.f', h('span', 'Name'), h('input', { name: 'label', type: 'text', required: true, placeholder: 'Solar' })),
    h('label.f', h('span', 'Start from a copy of'), h('select', { name: 'copyFrom' }, verts.map(v => h('option', { value: v.id }, v.label)))),
    h('p.muted.small', 'You\'ll edit the services, form, scoring and compliance rules next.'),
    h('div.row', h('button.btn.primary', { type: 'submit' }, 'Create'), h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel')));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    const r = await act(form.querySelector('[type=submit]'), () => api('/api/verticals', { method: 'POST', body: { ...b, id: b.label } }), 'Vertical created');
    cache.verticals = []; close(); location.hash = `#/vertical/${r.id}`;
  };
  const close = overlay(h('div.modal', form), { center: true });
}

async function verticalEditor(id) {
  const view = currentView;
  const v = await api(`/api/verticals/${id}`);
  setCrumbs(['Verticals', '#/verticals'], v.label);
  let mode = 'form';
  let ed;
  const holder = h('div');
  const saveBtn = h('button.btn.primary', { disabled: true }, 'Save changes');
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  const raw = h('textarea.md', { oninput: mark, spellcheck: false });
  const hints = {
    _comment: { hidden: true },
    id: { readonly: true },
    heroTitle: { hint: '{{city}} is replaced with the main city.' },
    heroSub: { widget: 'textarea', hint: 'Subheading under the homepage H1.' },
    cta: { label: 'Button text' },
    audience: { widget: 'textarea', hint: 'Who the content is written for (used in the AI prompt).' },
    services: { itemLabel: 'service', template: { slug: '', name: '', keyword: '', angle: '', faqs: [{ q: '', a: '' }] }, hint: 'Each service gets a state-level guide plus one page per city. Slug = URL, lowercase-hyphens. Changing a slug changes URLs.' },
    'services.*.angle': { widget: 'textarea', hint: 'What this page focuses on (drives AI content and templates).' },
    'services.*.keyword': { hint: 'Main search phrase this page targets.' },
    'services.*.faqs': { itemLabel: 'FAQ', template: { q: '', a: '' }, hint: 'Human-written, shown on the page and in FAQ schema. Keep answers accurate and hedged.' },
    'services.*.faqs.*.a': { widget: 'textarea', label: 'Answer' }, 'services.*.faqs.*.q': { label: 'Question' },
    form: { hint: 'The lead form. first_name, last_name, phone, email and zip are required by the lead API.' },
    'form.steps': { itemLabel: 'step', template: { title: '', fields: [{ name: '', label: '', type: 'text', required: false }] } },
    'form.steps.*.fields': { itemLabel: 'field', template: { name: '', label: '', type: 'select', required: true, options: [''] } },
    'form.steps.*.fields.*.type': { widget: 'select', options: ['select', 'text', 'tel', 'email', 'zip'] },
    'form.steps.*.fields.*.name': { hint: 'Internal key (lowercase_with_underscores). Scoring rules reference this.' },
    scoring: { hint: 'Each matching rule adds points (0–100 total). Tier A ≥ tiers.A, B ≥ tiers.B, else C. Special fields: _phone_valid, _email_freemail_disposable, _time_on_page_s.' },
    'scoring.rules': { itemLabel: 'rule', template: { field: '', in: [''], points: 10 } },
    'scoring.rules.*.in': { label: 'Matches any of', hint: 'Exact option text from the form.' },
    suggestedPrice: { label: 'Suggested price by tier ($)' },
    'compliance.notAProvider': { widget: 'textarea', label: 'Footer disclosure', hint: '{{brand}} is replaced with the site brand.' },
    'compliance.contentRules': { label: 'Content rules', hint: 'Given to the AI as hard rules for every page.', itemWidget: 'textarea' },
    schemaType: { hint: 'schema.org type. Keep "Organization" unless you are a licensed agency/brokerage.' }
  };
  const drawForm = (val) => { ed = createEditor(val, hints, { onChange: mark }); holder.replaceChildren(ed.el); };
  const current = () => (mode === 'form' ? ed.getValue() : JSON.parse(raw.value));
  const switchTo = (m) => {
    if (m === mode) return;
    try {
      const val = current();
      mode = m;
      if (m === 'raw') { raw.value = JSON.stringify(val, null, 2); holder.replaceChildren(h('p.muted.small', 'Full JSON. Use this for anything the form doesn\'t show (e.g. new keys).'), raw); }
      else drawForm(val);
      tabs.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.m === m));
    } catch (e) { toast('Fix the JSON first: ' + e.message, 'bad'); }
  };
  const tabs = h('nav.tabs', h('a', { href: 'javascript:void 0', 'data-m': 'form', class: 'active', onclick: () => switchTo('form') }, 'Form'), h('a', { href: 'javascript:void 0', 'data-m': 'raw', onclick: () => switchTo('raw') }, 'Raw JSON'));
  saveBtn.onclick = async (e) => {
    let val;
    try { val = current(); } catch (err) { return toast('Invalid JSON: ' + err.message, 'bad'); }
    await act(e.target, () => api(`/api/verticals/${id}`, { method: 'PUT', body: val }), 'Vertical saved. Rebuild sites that use it.');
    dirty = false; e.target.disabled = true;
  };
  drawForm(v);
  view.replaceChildren(head(v.label, `verticals/${id}.json`), tabs, holder,
    h('div.sticky-bar', saveBtn, h('span.muted.small', 'Applies to every site using this vertical on its next build. New services need content generated.')));
}

// ---------------------------------------------------------------- partners ---
// Realtors, lenders and agents who receive leads automatically. The directory
// is private/partners.json on this PC; balances live in the cloud database.
const rebuildNote = () => h('div.notice', h('strong', 'After changing partners, rebuild and deploy each affected site '),
  '(Sites → Build & publish). The consent box on each page and the lead router both update on deploy.');

async function loadBalances() {
  try { return await api('/api/partner-balances'); } catch (e) { return { error: e.message, partners: {}, history: [] }; }
}

async function partnersList() {
  const view = currentView;
  setCrumbs('Partners');
  const [d, bal] = await Promise.all([api('/api/partners'), loadBalances()]);
  view.replaceChildren(
    head('Partners', 'Leads go to these partners automatically, the second they come in. They pay per lead from a prepaid balance.',
      h('button.btn.primary', { onclick: () => newPartnerModal() }, '+ Add partner')),
    bal.error && h('div.notice.warn', 'Balances unavailable: ', bal.error),
    d.partners.length ? h('div.table-wrap', h('table',
      h('thead', h('tr', ['Partner', 'Sites & areas', 'Price', 'Cap / 7 days', 'Balance', 'Status'].map(t => h('th', t)))),
      h('tbody', d.partners.map(p => {
        const b = bal.partners?.[p.id];
        const tiers = ['A', 'B', 'C'].filter(t => p.priceByTier?.[t] > 0).map(t => `${t} ${money(p.priceByTier[t])}`).join(' · ');
        return h('tr.click', { onclick: () => (location.hash = `#/partner/${p.id}`) },
          h('td', h('strong', p.name), h('div.muted.small', [p.company, p.license].filter(Boolean).join(' · '))),
          h('td', p.assignments.length ? p.assignments.map(a => h('div.small', a.brand, h('span.muted', ` · ${a.cities.length ? a.cities.length + ' cities' : 'all cities'}`))) : h('span.muted.small', 'Not assigned to a site')),
          h('td', tiers || money(p.pricePerLead), h('div.muted.small', `min tier ${p.minTier}`)),
          h('td', b ? `${b.weekCount} / ${p.weeklyCap || '∞'}` : (p.weeklyCap || '∞')),
          h('td', p.prepaid ? (b ? money(b.balance) : '—') : h('span.muted', 'invoiced')),
          h('td', p.active ? pill('active', 'ok') : pill('paused', 'warn')));
      }))
    )) : h('div.card.empty', 'No partners yet. Add your first realtor or lender.'),
    h('p.muted.small', { style: { marginTop: '10px' } }, `Stored privately in ${d.file} on this PC (never uploaded to GitHub). Back it up: open a partner and use Export, or copy that file somewhere safe.`)
  );
}

function newPartnerModal() {
  const f = (name, label, attrs = {}, hint) => h('label.f', h('span', label), h('input', { name, type: 'text', ...attrs }), hint && h('span.hint', hint));
  const form = h('form', h('h2', 'Add partner'),
    f('name', 'Name (as it should appear in the consent box)', { required: true, placeholder: 'Jane Smith' }),
    f('company', 'Company', { placeholder: 'ABC Realty' }),
    f('license', 'License', { placeholder: 'SC RE License #12345 or NMLS #12345' }),
    f('email', 'Lead delivery email', { type: 'email', required: true }),
    f('phone', 'Phone (shown to the lead)', { placeholder: '843-555-0100' }),
    h('div.ed-cols', f('pricePerLead', 'Price per lead ($)', { type: 'number', value: 50, min: 0 }), f('weeklyCap', 'Max leads per 7 days', { type: 'number', value: 10, min: 0 })),
    h('div.row', h('button.btn.primary', { type: 'submit' }, 'Add partner'), h('button.btn', { type: 'button', onclick: () => close() }, 'Cancel')));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    const r = await act(form.querySelector('[type=submit]'), () => api('/api/partners', { method: 'POST', body: { ...b, active: true, prepaid: true, minTier: 'B' } }), 'Partner added');
    close(); location.hash = `#/partner/${r.id}`;
  };
  const close = overlay(h('div.modal', form), { center: true });
}

async function partnerDetail(id) {
  const view = currentView;
  const [d, bal] = await Promise.all([api('/api/partners'), loadBalances()]);
  const p = d.partners.find(x => x.id === id);
  if (!p) throw new Error('Partner not found');
  setCrumbs(['Partners', '#/partners'], p.name);
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  const val = { ...p, priceByTier: { ...p.priceByTier } };
  const input = (key, label, attrs = {}, hint) => h('label.f', h('span', label),
    h('input', { type: 'text', value: val[key] ?? '', ...attrs, oninput: (e) => { val[key] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; mark(); } }),
    hint && h('span.hint', hint));
  const check = (key, label, hint) => h('label.f', h('span', h('input', { type: 'checkbox', checked: !!val[key], onchange: (e) => { val[key] = e.target.checked; mark(); } }), ' ', label), hint && h('span.hint', hint));
  const tierInput = (t) => h('label.f', h('span', `Tier ${t} price ($)`), h('input', { type: 'number', min: 0, value: val.priceByTier[t] || '', placeholder: 'flat', oninput: (e) => { val.priceByTier[t] = Number(e.target.value) || 0; mark(); } }));

  // Site + city assignments
  const asg = Object.fromEntries(p.assignments.map(a => [a.site, { ...a }]));
  const sitesBox = h('div', d.sites.map(s => {
    const a = asg[s.slug];
    const on = h('input', { type: 'checkbox', checked: !!a, onchange: (e) => { if (e.target.checked) asg[s.slug] = { site: s.slug, cities: [], zips: [], services: [] }; else delete asg[s.slug]; mark(); draw(); } });
    const inner = h('div', { style: { paddingLeft: '24px' } });
    const draw = () => {
      const cur = asg[s.slug];
      inner.replaceChildren();
      if (!cur) return;
      inner.append(
        h('div.f-label', 'Cities ', h('span.hint', { style: { display: 'inline' } }, '(none checked = every city on this site)')),
        h('div.row', { style: { gap: '4px 14px', marginBottom: '8px' } }, s.cities.map(c => h('label.small', h('input', { type: 'checkbox', checked: cur.cities.includes(c.slug), onchange: (e) => { cur.cities = e.target.checked ? [...cur.cities, c.slug] : cur.cities.filter(x => x !== c.slug); mark(); } }), ' ', c.name))),
        h('div.f-label', 'Services ', h('span.hint', { style: { display: 'inline' } }, '(none checked = all)')),
        h('div.row', { style: { gap: '4px 14px', marginBottom: '8px' } }, s.services.map(sv => h('label.small', h('input', { type: 'checkbox', checked: (cur.services || []).includes(sv.slug), onchange: (e) => { cur.services = e.target.checked ? [...(cur.services || []), sv.slug] : cur.services.filter(x => x !== sv.slug); mark(); } }), ' ', sv.name))),
        h('label.f', h('span', 'Extra ZIP codes (optional)'), h('input', { type: 'text', value: (cur.zips || []).join(', '), placeholder: '29577, 29579', oninput: (e) => { cur.zips = e.target.value.split(/[\s,]+/).filter(Boolean); mark(); } }), h('span.hint', 'Leads from homepage/guide pages with these ZIPs also go to this partner.'))
      );
    };
    draw();
    return h('div.card', { style: { padding: '12px 14px' } }, h('label', on, ' ', h('strong', s.brand), h('span.muted.small', ` · ${s.vertical}`)), inner);
  }));

  const saveBtn = h('button.btn.primary', { disabled: true, onclick: async (e) => {
    const { assignments, consentName, id: _id, ...fields } = val;
    await act(e.target, () => api(`/api/partners/${id}`, { method: 'PUT', body: { ...fields, assignments: Object.values(asg) } }), 'Partner saved. Rebuild and deploy the sites to apply.');
    dirty = false; e.target.disabled = true;
  } }, 'Save partner');

  // Portal link
  const liveDomains = d.sites.filter(s => p.assignments.some(a => a.site === s.slug) && s.domain && !/TODO/.test(s.domain));
  const domain = liveDomains[0]?.domain;
  const link = domain ? `https://${domain}/partner/#${p.portalToken}` : null;
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Copy failed: select the text instead', 'bad'); } };
  const portal = h('div.card', h('h3', 'Partner portal'),
    h('p.small.muted', 'A private link where this partner sees their leads, balance and asks for replacements. Send it to them by text or email. Treat it like a password.'),
    link ? h('div', h('input', { type: 'text', readOnly: true, value: link, onclick: (e) => e.target.select() }),
      h('div.row', { style: { marginTop: '8px' } }, h('button.btn.sm', { onclick: () => copy(link, 'Portal link') }, 'Copy portal link'),
        h('button.btn.sm', { onclick: async (e) => { if (!confirm('Make a new link? The old one stops working after you rebuild and deploy.')) return; await act(e.target, () => api(`/api/partners/${id}/token`, { method: 'POST' }), 'New link created. Rebuild and deploy to activate it.'); render(); } }, 'Make a new link')))
      : h('p.small', 'Assign this partner to a site that has a real domain to get their link.'));

  // Balance + payments
  const b = bal.partners?.[id];
  const amount = h('input', { type: 'number', min: 1, step: 'any', placeholder: 'e.g. 300' });
  const note = h('input', { type: 'text', placeholder: 'e.g. Zelle 10/27, 5 leads' });
  const history = (bal.history || []).filter(x => x.partner_id === id);
  const payments = h('div.card', h('h3', 'Balance & payments'),
    bal.error ? h('p.small.muted', bal.error) : h('div',
      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: '12px' } },
        stat(money(b?.balance), 'Balance'), stat(b?.weekCount ?? 0, 'Last 7 days'), stat(b?.totalDelivered ?? 0, 'All time'), stat(money(b?.spent), 'Billed')),
      h('div.ed-cols', h('label.f', h('span', 'Amount ($)'), amount, h('span.hint', 'Positive = payment received. Negative = adjustment.')), h('label.f', h('span', 'Note'), note)),
      h('div.row',
        h('button.btn.primary', { onclick: async (e) => { if (!Number(amount.value)) return toast('Enter an amount', 'bad'); await act(e.target, () => api(`/api/partners/${id}/credit`, { method: 'POST', body: { amount: Number(amount.value), note: note.value } }), 'Payment recorded'); render(); } }, 'Record payment'),
        h('button.btn', { onclick: async (e) => { const n = Math.max(1, Math.round(5 * (val.pricePerLead || 50))); await act(e.target, () => api(`/api/partners/${id}/credit`, { method: 'POST', body: { amount: n, note: 'Free pilot: 5 leads' } }), `Free pilot added (${money(n)})`); render(); } }, 'Give 5 free pilot leads')),
      history.length > 0 && h('div.table-wrap', { style: { marginTop: '12px' } }, h('table', h('thead', h('tr', h('th', 'Date'), h('th', 'Amount'), h('th', 'Note'))),
        h('tbody', history.map(x => h('tr', h('td.muted.small', fmtDate(x.created_at)), h('td', money(x.amount)), h('td', x.note || '')))))),
      val.payLink ? '' : h('p.small.muted', { style: { marginTop: '8px' } }, 'Tip: create a free Stripe Payment Link for a lead pack and paste it below so partners can top up from their portal.')));

  const exportBtn = h('button.btn.sm', { onclick: () => copy(JSON.stringify(p, null, 2), 'Partner details (JSON)') }, 'Export');
  const delBtn = h('button.btn.danger', { onclick: async (e) => {
    if (!confirm(`Remove ${p.name}? Their past leads stay in your records.`)) return;
    await act(e.target, () => api(`/api/partners/${id}`, { method: 'DELETE' }), 'Partner removed. Rebuild and deploy affected sites.');
    dirty = false; location.hash = '#/partners';
  } }, 'Remove partner');

  view.replaceChildren(
    head(p.name, [p.company, p.license].filter(Boolean).join(' · ') || 'Partner', exportBtn),
    rebuildNote(),
    h('div.grid.two',
      h('div',
        h('div.card', h('h3', 'Details'),
          input('name', 'Name', {}, `Consent boxes will read: "${p.consentName}". Changing it requires a rebuild.`),
          input('company', 'Company'), input('license', 'License'),
          input('email', 'Lead delivery email', { type: 'email' }, 'Every lead is emailed here the moment it arrives.'),
          input('phone', 'Phone', {}, 'Shown to the lead on the thank-you page and in their confirmation email.'),
          input('bookingUrl', 'Booking link', { placeholder: 'https://cal.com/jane/consult' }, 'Their Cal.com or Calendly link. Leads book directly with them right after submitting.'),
          input('webhook', 'Instant alert webhook (optional)', { placeholder: 'https://discord.com/api/webhooks/…' }),
          input('payLink', 'Payment link (optional)', { placeholder: 'https://buy.stripe.com/…' })),
        h('div.card', h('h3', 'Pricing & limits'),
          h('div.ed-cols', input('pricePerLead', 'Flat price per lead ($)', { type: 'number', min: 0 }), input('weeklyCap', 'Max leads per 7 days', { type: 'number', min: 0 }, '0 = no limit')),
          h('div.ed-cols', tierInput('A'), tierInput('B'), tierInput('C')),
          h('label.f', h('span', 'Lowest tier they receive'), h('select', { onchange: (e) => { val.minTier = e.target.value; mark(); } }, ['A', 'B', 'C'].map(t => h('option', { value: t, selected: val.minTier === t }, `Tier ${t}`))),
            h('span.hint', 'Lower-tier leads stay with you.')),
          check('prepaid', 'Prepaid (only deliver while they have balance)', 'Recommended. Turn off only for partners you invoice.'),
          check('active', 'Active (receiving leads)'))),
      h('div', h('div.card', h('h3', 'Where they get leads'), sitesBox), portal, payments)),
    h('div.sticky-bar', saveBtn, h('span', { style: { marginLeft: 'auto' } }), delBtn)
  );
}

// ------------------------------------------------------------------ guides ---
async function guidesList() {
  const view = currentView;
  setCrumbs('Guides');
  const docs = await api('/api/docs');
  view.replaceChildren(head('Guides', 'Step-by-step help and call scripts.'),
    h('div.grid', docs.filter(d => d.exists).map(d => h('a.card', { href: `#/guide/${d.id}`, style: { textDecoration: 'none', color: 'inherit' } }, h('h2', d.title)))));
}
async function guideView(id) {
  const view = currentView;
  const d = await api(`/api/docs/${id}`);
  setCrumbs(['Guides', '#/guides'], d.title);
  // These are trusted files from the repo's docs/ folder (never lead data),
  // so rendering their Markdown as HTML is safe here.
  const body = h('article.card.guide');
  body.innerHTML = marked.parse(d.markdown);
  // Checklists in guides become clickable for the current session.
  body.querySelectorAll('input[type=checkbox]').forEach(cb => (cb.disabled = false));
  view.replaceChildren(h('div.row', { style: { justifyContent: 'flex-end', marginBottom: '8px' } }, h('button.btn.sm', { onclick: () => window.print() }, 'Print')), body);
}

// -------------------------------------------------------------------- jobs ---
async function jobsView() {
  const view = currentView;
  setCrumbs('Activity');
  const jobs = await api('/api/jobs');
  const quick = [['test', 'Run tests'], ['leads', 'Pull leads'], ['cf-whoami', 'Check Cloudflare login']];
  view.replaceChildren(
    head('Activity', 'Builds, deploys, content runs and lead pulls from this session.', quick.map(([t, l]) => h('button.btn', { onclick: (e) => act(e.target, () => runJob(t, {}, { onDone: () => render() })) }, l))),
    jobs.length ? h('div.table-wrap', h('table', h('thead', h('tr', ['Started', 'Task', 'Site', 'Status', ''].map(t => h('th', t)))),
      h('tbody', jobs.map(j => h('tr',
        h('td.muted.small', fmtDate(j.started)), h('td', j.label), h('td', j.site || '—'),
        h('td', pill(j.status, { done: 'ok', failed: 'bad', running: 'info', stopped: 'warn' }[j.status])),
        h('td', h('button.btn.sm', { onclick: () => watchJob(j.id) }, 'View log')))))))
      : h('div.card.empty', 'Nothing has run yet in this session.')
  );
}

// ---------------------------------------------------------------- settings ---
async function settingsView() {
  const view = currentView;
  setCrumbs('Settings');
  const s = await api('/api/settings');
  const changes = {};
  const saveBtn = h('button.btn.primary', { disabled: true }, 'Save settings');
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  const groups = {};
  for (const k of s.keys) {
    const input = h('input', {
      type: k.secret ? 'password' : 'text', value: k.secret ? '' : k.value, autocomplete: 'off',
      placeholder: k.secret ? (k.set ? `Saved (${k.value}) — type to replace` : 'Not set') : '',
      oninput: (e) => { changes[k.key] = e.target.value; mark(); }
    });
    const extra = k.key === 'ADMIN_TOKEN' && h('button.btn.sm', { type: 'button', onclick: async () => {
      const { token } = await api('/api/settings/generate-token', { method: 'POST' });
      input.type = 'text'; input.value = token; changes.ADMIN_TOKEN = token; mark();
      toast('Token generated. Save, then paste the same value into Cloudflare.');
    } }, 'Generate');
    (groups[k.group] ||= []).push(h('label.f', h('span', k.key, ' ', k.set ? pill('set', 'ok') : ''), h('div.row', { style: { flexWrap: 'nowrap' } }, input, extra), k.hint && h('span.hint', k.hint)));
  }
  saveBtn.onclick = async (e) => {
    await act(e.target, () => api('/api/settings', { method: 'PUT', body: changes }), 'Settings saved to .env');
    dirty = false; render();
  };
  const ai = s.ai;
  view.replaceChildren(
    head('Settings', 'Stored in .env on this computer. Never committed to git.'),
    h('div.grid.two',
      h('div.card', h('h2', 'AI writer'),
        h('p', ai.ollama.reachable ? pill('Ollama running', 'ok') : pill('Ollama not reachable', 'warn'), ' ', ai.fallbacks.map(f => pill(f, 'info'))),
        ai.ollama.reachable
          ? h('p.small', 'Installed models: ', ai.ollama.models.join(', ') || 'none', !ai.ollama.models.some(m => m.startsWith(ai.model.split(':')[0])) && h('span.detail', ` — run "ollama pull ${ai.model}"`))
          : h('p.small.muted', 'Install Ollama (ollama.com), then run ', h('code', `ollama pull ${ai.model}`), ' and ', h('code', 'ollama serve'), '. Without it, free API keys below are used, then templates.'),
        groups.AI),
      h('div',
        h('div.card', h('h2', 'Cloudflare'),
          h('p.small.muted', 'Do these once, in order. Each opens a log at the bottom right.'),
          h('div.row',
            h('button.btn', { onclick: (e) => act(e.target, () => runJob('cf-login')) }, '1. Log in'),
            h('button.btn', { onclick: (e) => act(e.target, () => runJob('cf-whoami')) }, 'Check login'),
            h('button.btn', { onclick: (e) => act(e.target, () => runJob('d1-create', {}, { onDone: () => render() })) }, '2. Create database'),
            h('button.btn', { onclick: (e) => act(e.target, () => runJob('d1-schema')) }, '3. Apply schema')),
          h('details', { style: { marginTop: '12px' } }, h('summary.small', 'wrangler.toml'), h('pre.log', s.wranglerToml))),
        h('div.card', h('h2', 'Leads'), groups.Leads),
        h('div.card', h('h2', 'Settlement (optional)'), h('p.small.muted', 'Leave as "none" or "log". Koinos is experimental; see koinos/README.md.'), groups.Settlement))
    ),
    h('div.sticky-bar', saveBtn)
  );
}

render();
