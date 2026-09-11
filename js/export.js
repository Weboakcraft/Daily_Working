/**
 * Exports. Data always comes from the exportReport API, which applies the same permissions as the screens.
 * Excel uses SheetJS loaded on demand from cdnjs; CSV has no dependencies; PDF uses the browser's print dialog
 * ("Save as PDF"), which keeps Indian-language text and the ₹ sign intact.
 */
import { api } from './api.js';
import { html, esc, openModal, field, toast, errorMessage, withBusy, downloadBlob, fmtDate, fmtDateTime, titleCase } from './app.js';

const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
export const DATASETS = [
  { value: 'REPORTS', label: 'Daily reports with key answers' },
  { value: 'KPI', label: 'Department numbers (one column per question)' },
  { value: 'TASKS', label: 'Tasks' },
  { value: 'FOLLOWUPS', label: 'Follow-ups' }
];

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function toCsv(data) {
  const q = (v) => {
    let s = cellText(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet apps from running formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [data.columns.map((c) => q(c.label)).join(',')];
  data.rows.forEach((r) => lines.push(data.columns.map((c) => q(r[c.key])).join(',')));
  return '\uFEFF' + lines.join('\r\n');
}

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel library did not load.')));
    s.onerror = () => reject(new Error('Excel library could not be downloaded.'));
    document.head.appendChild(s);
  });
}

function fileBase(data) {
  return ('oakcraft-' + data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/-+$/, '');
}

export async function downloadExcel(data) {
  const XLSX = await loadSheetJs();
  const aoa = [data.columns.map((c) => c.label)].concat(data.rows.map((r) => data.columns.map((c) => {
    const v = r[c.key];
    return typeof v === 'number' ? v : cellText(v);
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = data.columns.map((c) => ({ wch: Math.min(60, Math.max(10, c.label.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  XLSX.writeFile(wb, fileBase(data) + '.xlsx');
}

export function printTable(win, data, meta) {
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
    <style>
      body{font:11px/1.4 'IBM Plex Sans',system-ui,sans-serif;color:#22262A;margin:18px}
      h1{font-size:18px;margin:0 0 4px} p{margin:0 0 12px;color:#62686E}
      table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #D8DCDA;padding:4px 6px;text-align:left;vertical-align:top}
      th{font-weight:600;border-bottom:1.5px solid #B9C0BC} tr{break-inside:avoid}
      @page{size:landscape;margin:12mm}
    </style></head><body>
    <h1>${esc(data.title)}</h1><p>${esc(meta)}</p>
    <table><thead><tr>${data.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${data.rows.map((r) => `<tr>${data.columns.map((c) => `<td>${esc(cellText(r[c.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  doc.close();
}

/** Opens the export dialog. opts: { dataset, filters, datasets? } */
export function openExportDialog(ctx, opts) {
  const datasets = opts.datasets ? DATASETS.filter((d) => opts.datasets.indexOf(d.value) >= 0) : DATASETS;
  const f = opts.filters || {};
  const m = openModal({
    title: 'Export data',
    body: html`<form class="stack" novalidate>
      ${field({ name: 'dataset', label: 'What to export', type: 'select', value: opts.dataset || datasets[0].value, options: datasets })}
      ${field({ name: 'format', label: 'Format', type: 'select', value: 'xlsx', options: [{ value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV' }, { value: 'pdf', label: 'PDF (opens the print dialog)' }] })}
      <p class="small muted">Uses the filters on this page${f.from ? ': ' + fmtDate(f.from) + ' to ' + fmtDate(f.to || f.from) : ''}. You only get data you are allowed to see. Large ranges can take up to a minute.</p>
    </form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-go>Export</button>`
  });
  const btn = m.el.querySelector('[data-go]');
  btn.onclick = () => withBusy(btn, async () => {
    const dataset = m.el.querySelector('[name="dataset"]').value;
    const format = m.el.querySelector('[name="format"]').value;
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    if (win) win.document.write('<p style="font-family:system-ui;padding:20px">Preparing export…</p>');
    try {
      const data = await api('exportReport', { dataset, filters: f });
      if (!data.rows.length) { if (win) win.close(); toast('Nothing to export for these filters.', 'info'); return; }
      const meta = 'Generated ' + fmtDateTime(data.generatedAt) + ' by ' + data.generatedBy + ', ' + data.rows.length + ' rows';
      if (format === 'csv') downloadBlob(fileBase(data) + '.csv', new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }));
      else if (format === 'xlsx') {
        try { await downloadExcel(data); } catch (e) {
          downloadBlob(fileBase(data) + '.csv', new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }));
          toast('Excel export needs internet access to load a helper. A CSV file was downloaded instead; it opens in Excel.', 'info');
        }
      } else if (win) printTable(win, data, meta);
      else toast('Allow pop-ups for this site to export a PDF.', 'bad');
      m.close();
      toast('Export ready: ' + data.rows.length + ' rows.');
    } catch (e) {
      if (win) win.close();
      toast(errorMessage(e), 'bad');
    }
  });
}
