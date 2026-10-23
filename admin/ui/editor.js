// admin/ui/editor.js
// -----------------------------------------------------------------------------
// Generic JSON editor. Renders ANY config object (site.json, a vertical) as a
// form: strings → inputs/textareas, numbers, booleans, arrays of objects →
// collapsible cards (add / duplicate / reorder / delete), arrays of values →
// editable lists. It edits the object in place; call getValue() to save.
//
// `hints` customize fields by path, with * for array indexes:
//   { 'cities.*.localNotes': { widget: 'textarea', hint: '...' },
//     'vertical': { widget: 'select', options: [...] },
//     'slug': { readonly: true }, '_comment': { hidden: true },
//     'cities': { template: { name: '', slug: '', localNotes: '' } } }
// -----------------------------------------------------------------------------
import { h } from './lib.js';

const human = (k) => String(k).replace(/^_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Empty value with the same shape as `v` (used for "Add" on arrays). */
function blank(v) {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  if (typeof v === 'number') return 0;
  if (typeof v === 'boolean') return false;
  return '';
}

function hintFor(hints, path) {
  const generic = path.replace(/\.\d+(?=\.|$)/g, '.*');
  return hints[path] || hints[generic] || {};
}

export function createEditor(value, hints = {}, { onChange } = {}) {
  const data = clone(value);
  const changed = () => onChange?.(data);
  const root = h('div.ed-obj.root');
  renderObject(root, data, '', true);
  return { el: root, getValue: () => clone(data) };

  // --- objects -------------------------------------------------------------
  function renderObject(container, obj, path, isRoot = false) {
    const prims = h('div.ed-cols');
    const rest = h('div');
    for (const key of Object.keys(obj)) {
      const p = path ? `${path}.${key}` : key;
      const hint = hintFor(hints, p);
      if (hint.hidden) continue;
      if (key.startsWith('_') && typeof obj[key] === 'string') { rest.prepend(h('div.ed-note', obj[key])); continue; }
      const v = obj[key];
      if (Array.isArray(v)) rest.append(renderArray(obj, key, p, hint));
      else if (v && typeof v === 'object') {
        const fs = h('fieldset.ed-obj', h('legend', hint.label || human(key)), hint.hint && h('div.ed-note', hint.hint));
        renderObject(fs, v, p);
        rest.append(fs);
      } else {
        const field = renderPrimitive(obj, key, p, hint);
        (hint.widget === 'textarea' || (typeof v === 'string' && v.length > 70) ? rest : prims).append(field);
      }
    }
    container.append(prims, rest);
  }

  // --- single values -------------------------------------------------------
  function renderPrimitive(obj, key, path, hint) {
    const v = obj[key];
    const label = h('span', hint.label || human(key));
    let input;
    if (typeof v === 'boolean') {
      input = h('input', { type: 'checkbox', checked: v, onchange: (e) => { obj[key] = e.target.checked; changed(); } });
      return h('label.f', h('span', input, ' ', hint.label || human(key)), hint.hint && h('span.hint', hint.hint));
    }
    if (hint.widget === 'select') {
      input = h('select', { onchange: (e) => { obj[key] = e.target.value; changed(); }, disabled: hint.readonly },
        (hint.options || []).map(o => h('option', { value: o, selected: o === v }, o)));
    } else if (hint.widget === 'color') {
      input = h('input', { type: 'color', value: v || '#000000', oninput: (e) => { obj[key] = e.target.value; changed(); } });
    } else if (hint.widget === 'textarea' || (typeof v === 'string' && v.length > 70)) {
      input = h('textarea', { value: v ?? '', rows: hint.rows || 3, readonly: hint.readonly, oninput: (e) => { obj[key] = e.target.value; changed(); } });
    } else {
      const isNum = typeof v === 'number';
      input = h('input', {
        type: isNum ? 'number' : 'text', value: v ?? '', readonly: hint.readonly, placeholder: hint.placeholder || '',
        step: isNum ? 'any' : undefined,
        oninput: (e) => { obj[key] = isNum ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value; changed(); }
      });
    }
    if (typeof v === 'string' && /TODO/.test(v)) input.style.borderColor = 'var(--warn)';
    return h('label.f', label, input, hint.hint && h('span.hint', hint.hint));
  }

  // --- arrays --------------------------------------------------------------
  function renderArray(parent, key, path, hint) {
    const arr = parent[key];
    const wrap = h('div.ed-arr');
    const objects = hint.template ? typeof hint.template === 'object' : arr.some(x => x && typeof x === 'object');
    const draw = () => {
      wrap.replaceChildren(
        h('div.f-label', hint.label || human(key), ' ', h('span.muted.small', `(${arr.length})`)),
        hint.hint && h('div.ed-note', hint.hint)
      );
      arr.forEach((item, i) => wrap.append(objects ? objectItem(arr, i, `${path}.${i}`, draw) : primItem(arr, i, draw, hint)));
      wrap.append(h('button.btn.sm', {
        type: 'button',
        onclick: () => {
          const tpl = hint.template !== undefined ? clone(hint.template) : arr.length ? blank(arr[0]) : '';
          arr.push(tpl); changed(); draw();
          if (objects) wrap.querySelectorAll(':scope > details')[arr.length - 1]?.setAttribute('open', '');
        }
      }, '+ Add ', hint.itemLabel || (objects ? 'item' : 'value')));
    };
    draw();
    return wrap;
  }

  function objectItem(arr, i, path, redraw) {
    const item = arr[i];
    const titleOf = () => item.name || item.title || item.label || item.q || item.field || item.slug || `Item ${i + 1}`;
    const title = h('span', titleOf());
    const tools = h('span.tools',
      h('button.btn.sm', { type: 'button', title: 'Move up', disabled: i === 0, onclick: (e) => { e.preventDefault(); [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; changed(); redraw(); } }, '↑'),
      h('button.btn.sm', { type: 'button', title: 'Move down', disabled: i === arr.length - 1, onclick: (e) => { e.preventDefault(); [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; changed(); redraw(); } }, '↓'),
      h('button.btn.sm', { type: 'button', title: 'Duplicate', onclick: (e) => { e.preventDefault(); arr.splice(i + 1, 0, clone(item)); changed(); redraw(); } }, '⧉'),
      h('button.btn.sm.danger', { type: 'button', title: 'Delete', onclick: (e) => { e.preventDefault(); if (confirm(`Delete "${titleOf()}"?`)) { arr.splice(i, 1); changed(); redraw(); } } }, '✕')
    );
    const body = h('div.body');
    renderObject(body, item, path);
    body.addEventListener('input', () => { title.textContent = titleOf(); });
    return h('details.ed-item', { open: arr.length <= 2 }, h('summary', title, tools), body);
  }

  function primItem(arr, i, redraw, hint) {
    const v = arr[i];
    const parse = (s) => (typeof v === 'number' ? Number(s) : typeof v === 'boolean' ? s === 'true' : s);
    const input = (typeof v === 'string' && v.length > 70) || hint.itemWidget === 'textarea'
      ? h('textarea', { value: v, rows: 2, oninput: (e) => { arr[i] = parse(e.target.value); changed(); } })
      : h('input', { type: 'text', value: String(v), oninput: (e) => { arr[i] = parse(e.target.value); changed(); } });
    return h('div.ed-prim', input,
      h('button.btn.sm.danger', { type: 'button', onclick: () => { arr.splice(i, 1); changed(); redraw(); } }, '✕'));
  }
}
