// Filter state <-> URL hash, so a filtered view can be bookmarked and shared.
//
// spec = {
//   q:      { type: 'text', max: 100 },
//   status: { type: 'set', allowed: ['achieved', ...] },       // empty set = no restriction
//   plan:   { type: 'choice', allowed: ['14fyp', ...] },       // '' = all
//   from:   { type: 'int', min: 1949, max: 2100 },              // null = unset
// }
//
// Everything read from the hash is untrusted input: unknown keys are ignored, values outside `allowed`
// are dropped, malformed percent-encoding does not throw, and text is length-capped.

export function defaultState(spec) {
  const s = {};
  for (const [key, def] of Object.entries(spec)) {
    s[key] = def.type === 'set' ? new Set() : def.type === 'int' ? null : '';
  }
  return s;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return null; // malformed sequence such as "%E0%A4%A"
  }
}

export function parseHash(hash, spec) {
  const state = defaultState(spec);
  const raw = String(hash ?? '').replace(/^#/, '');
  if (raw === '') return state;

  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = safeDecode(part.slice(0, eq));
    const value = safeDecode(part.slice(eq + 1));
    if (key === null || value === null || !Object.hasOwn(spec, key)) continue;
    const def = spec[key];

    switch (def.type) {
      case 'text':
        state[key] = value.replace(/\s+/g, ' ').trim().slice(0, def.max ?? 100);
        break;
      case 'choice':
        state[key] = def.allowed.includes(value) ? value : '';
        break;
      case 'set': {
        const wanted = new Set(value.split(',').map((v) => v.trim()));
        state[key] = new Set(def.allowed.filter((v) => wanted.has(v))); // keeps allowed order
        break;
      }
      case 'int': {
        // Strict integer: "2021abc", "1e3", "" and "  " are all rejected (Number('') would be 0!).
        const n = /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
        state[key] = n !== null && n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity) ? n : null;
        break;
      }
      default:
        break;
    }
  }
  return state;
}

export function serializeState(state, spec) {
  const parts = [];
  for (const [key, def] of Object.entries(spec)) {
    const v = state[key];
    let encoded = null;
    switch (def.type) {
      case 'text':
        if (v) encoded = encodeURIComponent(v);
        break;
      case 'choice':
        if (v) encoded = encodeURIComponent(v);
        break;
      case 'set':
        if (v && v.size > 0) encoded = def.allowed.filter((a) => v.has(a)).map(encodeURIComponent).join(',');
        break;
      case 'int':
        if (Number.isInteger(v)) encoded = String(v);
        break;
      default:
        break;
    }
    if (encoded) parts.push(`${key}=${encoded}`);
  }
  return parts.join('&');
}

/** A set filter with nothing selected means "no restriction". */
export function inSet(set, value) {
  return !set || set.size === 0 || set.has(value);
}
