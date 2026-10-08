// Tiny DOM builder. It never uses innerHTML: every string from data becomes a text node, so a record such as
// "<img src=x onerror=alert(1)>" is displayed literally instead of executed.

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNSAFE_URL = /^\s*(?:javascript|data|vbscript):/i;

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', String(value));
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        // setProperty needs kebab-case ("marginTop" would be silently ignored); custom properties keep their name.
        const name = prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        el.style.setProperty(name, String(v));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if ((key === 'href' || key === 'src') && UNSAFE_URL.test(String(value))) {
      continue; // drop dangerous schemes
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

function appendAll(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendAll(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  appendAll(el, children);
  return el;
}

/** Append children to an existing element, skipping null/undefined/false (native .append(null) writes the text "null"). */
export function add(el, ...children) {
  appendAll(el, children);
  return el;
}

/** Replace an element's children. Same null-skipping rules as add(). */
export function put(el, ...children) {
  el.replaceChildren();
  appendAll(el, children);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el;
}
