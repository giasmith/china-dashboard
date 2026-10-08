// Filter state kept in sync with location.hash.
//   - user changes use history.replaceState (no history spam, and no hashchange event => no feedback loop)
//   - back/forward or a hand-edited hash fires hashchange and is re-parsed (and sanitised) via parseHash

import { parseHash, serializeState, defaultState } from './state.js';

export function createStore(spec, onChange) {
  let state = parseHash(location.hash, spec);

  const persist = () => {
    const s = serializeState(state, spec);
    history.replaceState(null, '', s ? `#${s}` : `${location.pathname}${location.search}`);
  };

  window.addEventListener('hashchange', () => {
    state = parseHash(location.hash, spec);
    onChange(state, 'hash');
  });

  return {
    get state() {
      return state;
    },
    /** Merge a partial update. Sets are copied so callers cannot mutate shared state. */
    set(patch) {
      state = { ...state, ...patch };
      persist();
      onChange(state, 'user');
    },
    /** Reset every key except those listed in `keep` (e.g. the current selection). */
    reset(keep = []) {
      const fresh = defaultState(spec);
      for (const k of keep) fresh[k] = state[k];
      state = fresh;
      persist();
      onChange(state, 'user');
    },
  };
}

/** Toggle one member of a Set filter, returning a NEW set. */
export function toggled(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
