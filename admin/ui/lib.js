// admin/ui/lib.js — tiny helpers: DOM builder, API client, toasts, job runner.
// Everything user-supplied is inserted with textContent (never innerHTML),
// because lead fields come straight from the public internet.

/** h('div.card#id', { onclick, class, ... }, child, [children], 'text') */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [, tag = 'div', id, cls] = sel.match(/^([a-z0-9-]*)(?:#([\w-]+))?((?:\.[\w-]+)*)$/i) || [];
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (cls) el.className = cls.slice(1).replace(/\./g, ' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

const TOKEN = document.querySelector('meta[name=admin-token]').content;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'x-admin-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function toast(msg, kind = '') {
  const t = h('div.toast', { class: kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

/** Wrap an async action: disable button, toast errors. */
export async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, 'bad'); throw e; }
  finally { if (btn) btn.disabled = false; }
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const money = (n) => '$' + Number(n || 0).toLocaleString();
export const pill = (text, kind = '') => h('span.pill', { class: kind }, text);

export function overlay(content, { center = false, onClose } = {}) {
  const close = () => { o.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => e.key === 'Escape' && close();
  const o = h('div.overlay', { class: center ? 'center' : '', onclick: (e) => e.target === o && close() }, content);
  document.addEventListener('keydown', esc);
  document.body.append(o);
  return close;
}

// ------------------------------------------------------------- job runner ---
// Starts a job and streams its log into the dock. Resolves when it finishes.
const dock = () => document.getElementById('jobdock');

export async function runJob(type, opts = {}, { onDone } = {}) {
  let job;
  try { job = await api('/api/jobs', { method: 'POST', body: { type, ...opts } }); }
  catch (e) { toast(e.message, 'bad'); return null; }
  return watchJob(job.id, onDone);
}

export function watchJob(id, onDone) {
  const d = dock();
  d.hidden = false;
  d.replaceChildren();
  const status = h('span.pill.info', 'running');
  const title = h('strong', '…');
  const log = h('div.log');
  const stopBtn = h('button.btn.sm', { onclick: () => api(`/api/jobs/${id}/stop`, { method: 'POST' }).catch(e => toast(e.message, 'bad')) }, 'Stop');
  const closeBtn = h('button.icon-btn', { onclick: () => { d.hidden = true; stopped = true; }, 'aria-label': 'Close' }, '×');
  d.append(h('div.jd-head', title, status, h('span', { style: { marginLeft: 'auto' } }), stopBtn, closeBtn), log);
  let from = 0, stopped = false;
  return new Promise((resolve) => {
    const tick = async () => {
      if (stopped) return resolve(null); // dock was closed: stop polling
      try {
        const j = await api(`/api/jobs/${id}?from=${from}`);
        title.textContent = j.label + (j.site ? ` · ${j.site}` : '');
        for (const line of j.log) log.append(line + '\n');
        from += j.log.length;
        if (j.log.length) log.scrollTop = log.scrollHeight;
        status.textContent = j.status;
        status.className = 'pill ' + ({ done: 'ok', failed: 'bad', stopped: 'warn' }[j.status] || 'info');
        if (j.status !== 'running') {
          stopBtn.remove();
          if (j.status === 'done') toast(`${j.label} finished`);
          else if (j.status === 'failed') toast(`${j.label} failed — see log`, 'bad');
          onDone?.(j);
          return resolve(j);
        }
      } catch (e) { log.append('! ' + e.message + '\n'); }
      setTimeout(tick, 900);
    };
    tick();
  });
}
