// CSV export (RFC 4180) with spreadsheet-formula-injection protection.

const FORMULA_START = /^[=+\-@\t\r]/;

/** Convert one value to a safe CSV field (without surrounding quotes unless required). */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = Array.isArray(value) ? value.join('; ') : String(value);
  // A string that starts with = + - @ is executed as a formula by Excel/Sheets. Prefix an apostrophe.
  // (Real numbers are passed as numbers above and are therefore not affected.)
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Array<object>} rows
 * @param {Array<{key?: string, label: string, get?: (row: object) => any}>} columns
 * @returns {string} CSV text, CRLF line endings, no BOM
 */
export function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = (rows ?? []).map((row) =>
    columns.map((c) => csvCell(c.get ? c.get(row) : row?.[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** Trigger a browser download. A UTF-8 BOM is added so Excel reads Chinese text correctly. */
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
