// Data loading with explicit, human-readable failure modes.

import { DATA_FILES } from '../config.js';

export class DataError extends Error {
  constructor(message, { file = null, hint = null } = {}) {
    super(message);
    this.name = 'DataError';
    this.file = file;
    this.hint = hint;
  }
}

export async function loadJson(path) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    throw new DataError('This page was opened straight from disk, and browsers block data loading from file:// URLs.', {
      hint: 'Run `python3 -m http.server 8000 --directory site` in the project folder, then open http://localhost:8000/.',
    });
  }
  let res;
  try {
    res = await fetch(path, { cache: 'no-cache' });
  } catch {
    throw new DataError(`Could not reach ${path}. Check your connection and reload.`, { file: path });
  }
  if (!res.ok) {
    throw new DataError(`${path} returned HTTP ${res.status}.`, {
      file: path,
      hint: res.status === 404 ? 'The file is missing from the published site. Check the data folder and the Pages deployment.' : null,
    });
  }
  try {
    return await res.json();
  } catch {
    throw new DataError(`${path} is not valid JSON.`, { file: path, hint: 'Run `python3 scripts/validate_data.py` to find the syntax error.' });
  }
}

/** Fail loudly (with the file name) when a loaded file does not have the expected top-level arrays. */
function expectArray(doc, key, file) {
  if (!doc || !Array.isArray(doc[key])) {
    throw new DataError(`${file} is missing the "${key}" array.`, {
      file,
      hint: 'Run `python3 scripts/validate_data.py` to see which field is wrong.',
    });
  }
}

const SHAPES = {
  targets: ['plans', 'targets'],
  actuals: ['actuals'],
  legislation: ['documents'],
  hubs: ['features'],
  projects: ['projects'],
};

/**
 * Load the named datasets in parallel. Rejects with a DataError naming the first file that failed.
 * @param {Array<'meta'|'targets'|'actuals'|'legislation'|'hubs'|'projects'>} keys
 */
export async function loadDatasets(keys) {
  const entries = await Promise.all(
    keys.map(async (key) => {
      const file = DATA_FILES[key];
      if (!file) throw new DataError(`Unknown dataset "${key}".`);
      const doc = await loadJson(file);
      for (const arrayKey of SHAPES[key] ?? []) expectArray(doc, arrayKey, file);
      return [key, doc];
    }),
  );
  return Object.fromEntries(entries);
}
