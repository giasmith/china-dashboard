// Reusable filter controls. Each returns { el, set(value) } so the page can push state back into the control
// (e.g. after the URL hash changes) without rebuilding it.

import { h } from './dom.js';
import { debounce } from './ui.js';

export function searchField({ id, label, placeholder, onInput }) {
  const input = h('input', { id, class: 'input', type: 'search', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const commit = debounce(() => onInput(input.value), 150);
  input.addEventListener('input', commit);
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, label), input),
    set: (v) => {
      if (commit.pending()) return; // the user is mid-edit; their pending value will replace the state anyway
      if (input.value !== v) input.value = v ?? '';
    },
  };
}

export function selectField({ id, label, options, onChange }) {
  const select = h('select', { id, class: 'select' },
    options.map((o) => h('option', { value: o.value }, o.label)));
  select.addEventListener('change', () => onChange(select.value));
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, label), select),
    set: (v) => {
      select.value = options.some((o) => o.value === v) ? v : options[0].value;
    },
  };
}

/** Multi-select as checkboxes. Nothing checked = no restriction (the hint says so). */
export function checkGroup({ legend, name, options, onChange }) {
  const boxes = new Map();
  const fieldset = h('fieldset', { class: 'group' },
    h('legend', null, legend),
    options.map((o) => {
      const input = h('input', { type: 'checkbox', name, value: o.value });
      boxes.set(o.value, input);
      input.addEventListener('change', () => {
        onChange(new Set([...boxes].filter(([, el]) => el.checked).map(([value]) => value)));
      });
      return h('label', { class: 'check' }, input, h('span', null, o.label), o.count !== undefined ? h('span', { class: 'count' }, String(o.count)) : null);
    }));
  return {
    el: fieldset,
    set: (selected) => {
      for (const [value, el] of boxes) el.checked = selected.has(value);
    },
  };
}

/**
 * Year input that accepts only a strict integer in [min, max].
 * onChange(value | null). Invalid text shows an inline message and yields null (never 0 or NaN).
 */
export function yearField({ id, label, min, max, onChange }) {
  const input = h('input', { id, class: 'input', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'YYYY', 'aria-describedby': `${id}-msg` });
  const msg = h('div', { id: `${id}-msg`, class: 'hint' });
  const parse = () => {
    const raw = input.value.trim();
    if (raw === '') return { value: null, error: '' };
    if (!/^\d{4}$/.test(raw)) return { value: null, error: 'Enter a 4-digit year.' };
    const n = Number(raw);
    if (n < min || n > max) return { value: null, error: `Use a year between ${min} and ${max}.` };
    return { value: n, error: '' };
  };
  // Two independent message slots so an externally supplied message (e.g. "To is before From") and the field's own
  // parse error can never erase each other. The field's own error wins when both exist.
  let ownError = '';
  let externalError = '';
  const paint = () => {
    const text = ownError || externalError;
    msg.textContent = text;
    msg.className = text ? 'hint err' : 'hint';
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  };
  const commit = debounce(() => {
    const { value, error } = parse();
    ownError = error;
    paint();
    onChange(value);
  }, 200);
  input.addEventListener('input', commit);
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, label), input, msg),
    set: (v) => {
      if (commit.pending()) return; // see searchField.set
      const text = Number.isInteger(v) ? String(v) : '';
      if (input.value.trim() !== text && (text !== '' || parse().error === '')) input.value = text;
    },
    setError: (text) => {
      externalError = text ?? '';
      paint();
    },
  };
}

export function resetButton(onClick) {
  return h('button', { type: 'button', class: 'btn', onclick: onClick }, 'Reset filters');
}
