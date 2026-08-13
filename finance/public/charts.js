/* Chart primitives: line/area, grouped bars, donut, sankey, sparkline, stacked bar. */
'use strict';

/* ------------------------------ shared bits ----------------------------- */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const chartTip = () => document.getElementById('chart-tip');

function showTip(x, y, html) {
  const t = chartTip();
  t.innerHTML = html;
  t.classList.remove('hidden');
  const pad = 10, w = t.offsetWidth, hgt = t.offsetHeight;
  t.style.left = Math.min(Math.max(x, w / 2 + pad), window.innerWidth - w / 2 - pad) + 'px';
  t.style.top = Math.max(hgt + pad, y) + 'px';
}
function hideTip() { chartTip().classList.add('hidden'); }

// Nice round axis ticks.
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const fmtTick = (v) => {
  const a = Math.abs(v);
  const short = (n, div, sfx) => {
    const q = n / div;
    return (Number.isInteger(q) ? q.toFixed(0) : q.toFixed(1)) + sfx;
  };
  if (a >= 1e6) return short(v, 1e6, 'M');
  if (a >= 1e3) return short(v, 1e3, 'K');
  return String(Math.round(v * 10) / 10);
};

// Re-render responsive charts when the container width changes.
function responsive(wrap, render) {
  wrap._render = render;
  requestAnimationFrame(render);
  return wrap;
}

/* --------------------------- line / area chart -------------------------- */

function lineChart(points, { height = 240, showAxis = true, color } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const gid = 'g' + Math.random().toString(36).slice(2, 9);

  return responsive(wrap, () => {
    const W = wrap.clientWidth || 640, H = height;
    const padL = showAxis ? 52 : 4, padR = 8, padT = 12, padB = showAxis ? 26 : 4;
    const iw = W - padL - padR, ih = H - padT - padB;
    const vals = points.map((p) => p.value);
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
    const X = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const Y = (v) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;

    const grid = cssVar('--grid'), muted = cssVar('--ink-3');
    const c = color || cssVar('--chart-line'), surface = cssVar('--surface');

    let g = '';
    if (showAxis) {
      for (const t of ticks) {
        g += `<line x1="${padL}" y1="${Y(t)}" x2="${W - padR}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/>`;
        g += `<text x="${padL - 10}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`;
      }
      const idxs = points.length > 2 ? [0, Math.floor(points.length / 2), points.length - 1] : points.map((_, i) => i);
      for (const i of idxs) {
        const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
        g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${anchor}" font-size="11" fill="${muted}">${points[i].label || ''}</text>`;
      }
    }

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
    const area = line + `L${X(points.length - 1).toFixed(1)},${padT + ih}L${X(0).toFixed(1)},${padT + ih}Z`;
    const last = points[points.length - 1];

    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Balance over time">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${c}" stop-opacity="0.02"/>
      </linearGradient></defs>
      ${g}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(points.length - 1)}" cy="${Y(last.value)}" r="4.5" fill="${c}" stroke="${surface}" stroke-width="2"/>
      <line id="xh" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="${muted}" stroke-width="1" opacity="0"/>
      <circle id="xd" r="4.5" fill="${c}" stroke="${surface}" stroke-width="2" opacity="0"/>
      <rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent" id="hover"/>
    </svg>`;

    const svg = wrap.firstElementChild;
    const hover = svg.querySelector('#hover'), xh = svg.querySelector('#xh'), xd = svg.querySelector('#xd');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - padL) / iw) * (points.length - 1))));
      const p = points[i];
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('opacity', '0.45');
      xd.setAttribute('cx', X(i)); xd.setAttribute('cy', Y(p.value)); xd.setAttribute('opacity', '1');
      showTip(r.left + (X(i) / W) * r.width, r.top + (Y(p.value) / H) * r.height,
        `${p.tipLabel || p.label || ''}<br><b>${p.display || p.value}</b>`);
    };
    hover.addEventListener('pointermove', move);
    hover.addEventListener('pointerdown', move);
    hover.addEventListener('pointerleave', () => {
      xh.setAttribute('opacity', '0'); xd.setAttribute('opacity', '0'); hideTip();
    });
  });
}

/* ------------------------------- sparkline ------------------------------ */

function sparkline(values, { width = 84, height = 30, color } = {}) {
  const el = document.createElement('span');
  el.className = 'spark';
  if (!values || values.length < 2) return el;
  const min = Math.min(...values), max = Math.max(...values);
  const X = (i) => (i / (values.length - 1)) * (width - 2) + 1;
  const Y = (v) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const c = color || cssVar('--ink-3');
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return el;
}

/* ---------------------------- grouped bar chart -------------------------- */

function groupedBars(data, series, { height = 240, fmtValue = String } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';

  return responsive(wrap, () => {
    const W = wrap.clientWidth || 640, H = height;
    const padL = 52, padR = 8, padT = 12, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxV = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key])));
    const { hi, ticks } = niceTicks(0, maxV);
    const Y = (v) => padT + ih - (v / hi) * ih;
    const grid = cssVar('--grid'), muted = cssVar('--ink-3'), baseline = cssVar('--baseline');

    const band = iw / data.length;
    const barW = Math.max(6, Math.min(24, (band - 20) / series.length));
    let g = '';
    for (const t of ticks) {
      if (t === 0) continue;
      g += `<line x1="${padL}" y1="${Y(t)}" x2="${W - padR}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/>`;
      g += `<text x="${padL - 10}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`;
    }
    g += `<line x1="${padL}" y1="${Y(0)}" x2="${W - padR}" y2="${Y(0)}" stroke="${baseline}" stroke-width="1"/>`;

    data.forEach((d, i) => {
      const cx = padL + band * i + band / 2;
      g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${muted}">${d.label}</text>`;
      series.forEach((s, j) => {
        const totalW = series.length * barW + (series.length - 1) * 2;
        const x = cx - totalW / 2 + j * (barW + 2);
        const y = Y(d[s.key]), bh = Math.max(0, Y(0) - y);
        if (bh <= 0) return;
        const r = Math.min(4, bh);
        g += `<path d="M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${bh - r} h${-barW} Z" fill="${cssVar(s.color)}"/>`;
      });
    });

    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly comparison">${g}<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent" id="hover"/></svg>`;
    const svg = wrap.firstElementChild;
    const hover = svg.querySelector('#hover');
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(data.length - 1, Math.floor((px - padL) / band)));
      const d = data[i];
      const cx = padL + band * i + band / 2;
      showTip(r.left + (cx / W) * r.width, r.top + 24,
        `<b>${d.label}</b><br>` + series.map((s) => `${s.name} <b>${fmtValue(d[s.key])}</b>`).join('<br>'));
    };
    hover.addEventListener('pointermove', move);
    hover.addEventListener('pointerdown', move);
    hover.addEventListener('pointerleave', hideTip);
  });
}

/* --------------------------------- donut -------------------------------- */

function donut(slices, { size = 210, centerLabel = 'Total', centerValue = '' } = {}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = size / 2 - 4, r0 = R * 0.62, cx = size / 2, cy = size / 2;
  const surface = cssVar('--surface');
  let a0 = -Math.PI / 2, paths = '';

  slices.forEach((s, i) => {
    const frac = s.value / total;
    // A full-circle single slice can't be drawn as an arc; use two half arcs.
    const a1 = a0 + Math.min(frac, 0.9999) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const P = (a, rad) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    paths += `<path d="M${P(a0, R)} A${R},${R} 0 ${large} 1 ${P(a1, R)} L${P(a1, r0)} A${r0},${r0} 0 ${large} 0 ${P(a0, r0)} Z"
      fill="${s.color}" stroke="${surface}" stroke-width="2" data-i="${i}"/>`;
    a0 = a1;
  });

  const el = document.createElement('div');
  el.className = 'donut';
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Breakdown by category">
    ${paths}
    <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="19" font-weight="700" fill="${cssVar('--ink')}">${centerValue}</text>
    <text x="${cx}" y="${cy + 21}" text-anchor="middle" font-size="12" fill="${cssVar('--ink-3')}">${centerLabel}</text>
  </svg>`;

  const svg = el.firstElementChild;
  svg.addEventListener('pointermove', (e) => {
    const t = e.target.closest('path[data-i]');
    if (!t) return hideTip();
    const s = slices[+t.dataset.i];
    showTip(e.clientX, e.clientY, `${s.name}<br><b>${s.display}</b> · ${((s.value / total) * 100).toFixed(1)}%`);
  });
  svg.addEventListener('pointerleave', hideTip);
  return el;
}

/* ------------------------------ stacked bar ----------------------------- */

function stackedBar(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const el = document.createElement('div');
  el.className = 'stacked-bar';
  for (const s of segments) {
    const i = document.createElement('i');
    i.style.width = (s.value / total) * 100 + '%';
    i.style.background = s.color;
    i.title = `${s.name}: ${s.display}`;
    el.append(i);
  }
  return el;
}

/* --------------------------------- sankey -------------------------------- */
/*
 * Columns of nodes with proportional heights; links are cubic-bezier ribbons
 * whose thickness equals their value. Node y positions are stacked per column
 * in the order links arrive, so ribbons cross as little as possible.
 */
function sankey(nodes, links, { height = 620, nodeWidth = 12, gap = 18, labelSpace = 28 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap sankey-wrap';

  return responsive(wrap, () => {
    const outerW = Math.max(wrap.clientWidth || 900, 760);
    const W = outerW, H = height;
    const cols = Math.max(...nodes.map((n) => n.col)) + 1;
    const padT = 14, padB = 14;

    // Column x positions: last column's labels sit to its left, so reserve space.
    const usable = W - labelSpace - 16;
    const colX = (c) => 8 + (cols === 1 ? 0 : (c / (cols - 1)) * (usable - nodeWidth));

    // Node values: max of incoming/outgoing.
    const byCol = Array.from({ length: cols }, () => []);
    for (const n of nodes) {
      n.in = links.filter((l) => l.target === n.id).reduce((s, l) => s + l.value, 0);
      n.out = links.filter((l) => l.source === n.id).reduce((s, l) => s + l.value, 0);
      n.value = Math.max(n.in, n.out);
      byCol[n.col].push(n);
    }

    // Scale: the fullest column defines pixels-per-unit.
    let scale = Infinity;
    for (const col of byCol) {
      if (!col.length) continue;
      const sum = col.reduce((s, n) => s + n.value, 0);
      const avail = H - padT - padB - gap * (col.length - 1);
      scale = Math.min(scale, avail / sum);
    }
    if (!isFinite(scale) || scale <= 0) scale = 1;

    // Stack each column, keeping the caller's node order.
    for (const col of byCol) {
      let y = padT;
      for (const n of col) {
        n.h = Math.max(2, n.value * scale);
        n.y = y;
        y += n.h + gap;
      }
      // Center the column vertically.
      const used = y - gap - padT;
      const shift = (H - padT - padB - used) / 2;
      for (const n of col) n.y += shift;
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    // Track how much of each node's edge is consumed by ribbons already placed.
    const outCursor = new Map(), inCursor = new Map();
    for (const n of nodes) { outCursor.set(n.id, n.y); inCursor.set(n.id, n.y); }

    let ribbons = '';
    links.forEach((l, i) => {
      const s = nodeById.get(l.source), t = nodeById.get(l.target);
      if (!s || !t) return;
      const th = Math.max(1, l.value * scale);
      const sy = outCursor.get(s.id), ty = inCursor.get(t.id);
      outCursor.set(s.id, sy + th);
      inCursor.set(t.id, ty + th);

      const x0 = colX(s.col) + nodeWidth, x1 = colX(t.col);
      const cx = (x0 + x1) / 2;
      const d = `M${x0},${sy} C${cx},${sy} ${cx},${ty} ${x1},${ty}
                 L${x1},${ty + th} C${cx},${ty + th} ${cx},${sy + th} ${x0},${sy + th} Z`;
      ribbons += `<path class="ribbon" d="${d}" fill="${l.color}" opacity="0.34" data-link="${i}"/>`;
    });

    let rects = '', labels = '';
    // Labels sit right of the source columns and left of the destination
    // columns, so a column's text never lands on the next column's text.
    const lastBottom = new Map();
    for (const n of nodes) {
      const x = colX(n.col);
      rects += `<rect x="${x}" y="${n.y}" width="${nodeWidth}" height="${n.h}" rx="2" fill="${n.color}" data-node="${n.id}"/>`;
      const labelLeft = n.col >= 2;
      const tx = labelLeft ? x - 10 : x + nodeWidth + 10;
      const anchor = labelLeft ? 'end' : 'start';
      const cyN = n.y + n.h / 2;
      const twoLine = n.h >= 24;
      const top = cyN - (twoLine ? 14 : 8), bottom = cyN + (twoLine ? 18 : 8);
      // Drop a label that would collide with the one above it in this column;
      // the value stays reachable via hover and the table view.
      if (n.h < 9 || top < (lastBottom.get(n.col) ?? -Infinity)) continue;
      lastBottom.set(n.col, bottom);
      if (twoLine) {
        labels += `<text x="${tx}" y="${cyN - 2}" text-anchor="${anchor}" font-size="12.5" font-weight="600" fill="${cssVar('--ink')}">${n.label}</text>`;
        labels += `<text x="${tx}" y="${cyN + 14}" text-anchor="${anchor}" font-size="12.5" fill="${cssVar('--ink-2')}" style="font-variant-numeric:tabular-nums">${n.display}</text>`;
      } else {
        labels += `<text x="${tx}" y="${cyN + 4}" text-anchor="${anchor}" font-size="11.5" fill="${cssVar('--ink-2')}">${n.label} · ${n.display}</text>`;
      }
    }

    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="Cash flow from income through categories">${ribbons}${rects}${labels}</svg>`;

    const svg = wrap.firstElementChild;
    svg.addEventListener('pointermove', (e) => {
      const rb = e.target.closest('.ribbon');
      const nd = e.target.closest('rect[data-node]');
      if (rb) {
        const l = links[+rb.dataset.link];
        const s = nodeById.get(l.source), t = nodeById.get(l.target);
        showTip(e.clientX, e.clientY, `${s.label} → ${t.label}<br><b>${l.display}</b>`);
      } else if (nd) {
        const n = nodeById.get(nd.dataset.node);
        showTip(e.clientX, e.clientY, `${n.label}<br><b>${n.display}</b>`);
      } else hideTip();
    });
    svg.addEventListener('pointerleave', hideTip);
  });
}
