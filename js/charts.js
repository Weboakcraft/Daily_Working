/**
 * Small chart library (no external dependencies).
 * Charts render at the container's real pixel width so text stays legible on phones,
 * redraw on resize, and include a screen-reader data table.
 */
import { html, esc, setHTML, fmtNum } from './app.js';

export const SERIES_COLORS = ['var(--brand)', 'var(--info)', 'var(--accent)', 'var(--ok)', '#7D858B', 'var(--bad)'];
const TONES = { ok: 'var(--ok)', warn: '#C08A2A', bad: 'var(--bad)', info: 'var(--info)', accent: 'var(--accent)', brand: 'var(--brand)', off: '#B9C0BC', ink: 'var(--ink-2)' };
const color = (s, i) => TONES[s.tone] || s.color || SERIES_COLORS[i % SERIES_COLORS.length];

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

let tipEl = null;
function bindTips(el) {
  if (el._tips) return;
  el._tips = true;
  el.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { if (tipEl) tipEl.style.display = 'none'; return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = t.getAttribute('data-tip');
    tipEl.style.display = 'block';
    const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, e.clientX + 12);
    tipEl.style.left = x + 'px';
    tipEl.style.top = (e.clientY - tipEl.offsetHeight - 10) + 'px';
  });
  el.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
}

function mount(el, draw) {
  el._draw = draw;
  el._w = el.clientWidth;
  draw();
  bindTips(el);
  if (!el._ro && window.ResizeObserver) {
    let timer = null;
    el._ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (el.isConnected && el.clientWidth !== el._w) { el._w = el.clientWidth; el._draw(); } }, 120);
    });
    el._ro.observe(el);
  }
}

function srTable(title, labels, series, format) {
  return `<table class="sr-only"><caption>${esc(title)}</caption><thead><tr><th>Label</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${labels.map((l, i) => `<tr><th>${esc(l)}</th>${series.map((s) => `<td>${esc(format(s.values[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function legendHtml(series) {
  return html`<div class="legend">${series.map((s, i) => html`<span><i style="background:${color(s, i)}"></i>${s.name}</span>`)}</div>`;
}

/**
 * Vertical columns, grouped or stacked.
 * cfg: { title, labels, series:[{name, values, tone?}], stacked, format, height, max, labelFormat, markers:[{index, text}] }
 */
export function columnChart(el, cfg) {
  mount(el, () => {
    const fmt = cfg.format || ((v) => fmtNum(v));
    const W = Math.max(280, el.clientWidth || 600), H = cfg.height || 220;
    const m = { t: 14, r: 8, b: 30, l: 44 };
    const labels = cfg.labels, series = cfg.series, n = labels.length || 1;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const rawMax = cfg.stacked
      ? Math.max(0, ...labels.map((_, i) => series.reduce((a, s) => a + (Number(s.values[i]) || 0), 0)))
      : Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
    const max = cfg.max || niceMax(rawMax);
    const band = pw / n, gw = Math.max(2, band * (n > 20 ? 0.78 : 0.62));
    const bw = cfg.stacked ? gw : gw / series.length;
    const y = (v) => m.t + ph - (v / max) * ph;
    const every = n <= 12 ? 1 : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 58))));
    const maxChars = Math.max(3, Math.floor(band / 7));
    const fit = (t) => (n <= 12 && t.length > maxChars ? t.slice(0, maxChars - 1) + '…' : t);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title || 'Chart')}"><g class="grid">`;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const yy = y(max * f);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(max * f))}</text>`;
    });
    s += '</g>';
    labels.forEach((lab, i) => {
      const x0 = m.l + band * i + (band - gw) / 2;
      let acc = 0;
      series.forEach((ser, j) => {
        const v = Number(ser.values[i]) || 0;
        const h = (v / max) * ph;
        const x = cfg.stacked ? x0 : x0 + j * bw;
        const yy = cfg.stacked ? y(acc + v) : y(v);
        if (v > 0) s += `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(1, bw - (cfg.stacked ? 0 : 1)).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" rx="1.5" style="fill:${color(ser, j)}" data-tip="${esc(lab + '\n' + ser.name + ': ' + fmt(v))}"/>`;
        acc += v;
      });
      const shown = cfg.labelFormat ? cfg.labelFormat(lab) : lab;
      if (i % every === 0) s += `<text x="${(m.l + band * i + band / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(fit(shown))}<title>${esc(shown)}</title></text>`;
    });
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--rule-strong)"/></svg>`;
    el.innerHTML = s + srTable(cfg.title || 'Chart', labels, series, fmt);
  });
}

/** Line chart. cfg: { title, labels, series:[{name, values, tone?, dashed?}], format, height, max, min, labelFormat } */
export function lineChart(el, cfg) {
  mount(el, () => {
    const fmt = cfg.format || ((v) => fmtNum(v));
    const W = Math.max(280, el.clientWidth || 600), H = cfg.height || 220;
    const m = { t: 14, r: 12, b: 30, l: 44 };
    const labels = cfg.labels, series = cfg.series, n = labels.length;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const vals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined).map(Number));
    const max = cfg.max || niceMax(Math.max(0, ...vals));
    const min = cfg.min || 0;
    const x = (i) => m.l + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = (v) => m.t + ph - ((v - min) / (max - min || 1)) * ph;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 62))));
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title || 'Chart')}"><g class="grid">`;
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const v = min + (max - min) * f, yy = y(v);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    });
    s += '</g>';
    series.forEach((ser, j) => {
      const c = color(ser, j);
      let d = '', started = false;
      ser.values.forEach((v, i) => {
        if (v === null || v === undefined) { started = false; return; }
        d += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(v)).toFixed(1);
        started = true;
      });
      s += `<path d="${d}" fill="none" style="stroke:${c}" stroke-width="2" ${ser.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 45) ser.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        s += `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(v)).toFixed(1)}" r="${n > 20 ? 2.5 : 3.5}" style="fill:var(--panel);stroke:${c}" stroke-width="2" data-tip="${esc(labels[i] + '\n' + ser.name + ': ' + fmt(v))}"/>`;
      });
    });
    labels.forEach((lab, i) => {
      if (i % every === 0 || i === n - 1 && n < 10) s += `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(cfg.labelFormat ? cfg.labelFormat(lab) : lab)}</text>`;
    });
    s += '</svg>';
    el.innerHTML = s + srTable(cfg.title || 'Chart', labels, series, fmt);
  });
}

/** Horizontal labelled bars in HTML (wrap-friendly on phones). data: [{label, value, max?, note?, href?, tone?}] */
export function hbars(data, cfg) {
  cfg = cfg || {};
  const fmt = cfg.format || ((v) => fmtNum(v));
  const max = cfg.max || niceMax(Math.max(0, ...data.map((d) => Number(d.value) || 0)));
  return html`<div class="hbars" role="list">${data.map((d) => {
    const w = Math.max(0, Math.min(100, ((Number(d.value) || 0) / max) * 100));
    const label = d.href ? html`<a href="${d.href}">${d.label}</a>` : d.label;
    return html`<div class="hbar" role="listitem"><span class="hbar-label">${label}${d.note ? html`<span class="muted small"> ${d.note}</span>` : ''}</span>
      <span class="hbar-track" aria-hidden="true"><span style="width:${w.toFixed(1)}%;background:${TONES[d.tone] || TONES[cfg.tone] || 'var(--brand)'}"></span></span>
      <span class="hbar-val">${fmt(d.value)}</span></div>`;
  })}</div>`;
}

/** Single segmented bar with legend. parts: [{label, value, tone}] */
export function segmented(parts, total) {
  const sum = total || parts.reduce((a, p) => a + (Number(p.value) || 0), 0) || 1;
  return html`<div class="segbar" role="img" aria-label="${parts.map((p) => p.label + ' ' + p.value).join(', ')}">${parts.map((p) => html`<span style="width:${((Number(p.value) || 0) * 100 / sum).toFixed(2)}%;background:${TONES[p.tone] || p.tone}" data-tip="${p.label}: ${fmtNum(p.value, 0)}"></span>`)}</div>
    <div class="legend">${parts.map((p) => html`<span><i style="background:${TONES[p.tone] || p.tone}"></i>${p.label} <strong class="num">${fmtNum(p.value, 0)}</strong></span>`)}</div>`;
}

export function sparkline(values, tone) {
  const v = values.map((x) => Number(x) || 0);
  const W = 120, H = 32, max = Math.max(1, ...v), n = v.length;
  const pts = v.map((x, i) => ((n <= 1 ? W / 2 : (W * i) / (n - 1)).toFixed(1) + ',' + (H - 3 - (x / max) * (H - 6)).toFixed(1))).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" style="stroke:${TONES[tone] || 'var(--brand)'}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

export function enableTips(el) { bindTips(el); }
export { setHTML };
