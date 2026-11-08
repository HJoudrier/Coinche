// Courbe d'évolution des scores (SVG), avec réticule et infobulle au survol / toucher.
import { h, clear } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

/**
 * @param {HTMLElement} box
 * @param {{series:{name, cls, values:number[]}[], target?:number, xLabel:(i)=>string}} o
 */
export function lineChart(box, o) {
  const draw = () => {
    clear(box);
    const W = Math.max(260, box.clientWidth || 320);
    const H = Math.round(Math.min(260, Math.max(180, W * 0.55)));
    const m = { l: 40, r: 44, t: 14, b: 24 };
    const n = o.series[0].values.length;
    const maxV = Math.max(o.target || 0, ...o.series.flatMap((x) => x.values), 10);
    const step = niceStep(maxV);
    const top = Math.ceil(maxV / step) * step;
    const x = (i) => m.l + (n <= 1 ? 0 : (i * (W - m.l - m.r)) / (n - 1));
    const y = (v) => m.t + (H - m.t - m.b) * (1 - v / top);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': 'Évolution des scores par manche' });
    for (let v = 0; v <= top; v += step) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
      const t = s('text', { x: m.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = v;
      svg.append(t);
    }
    if (o.target) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(o.target), y2: y(o.target), class: 'target-line' }));
    }
    const every = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += every) {
      const t = s('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' });
      t.textContent = i;
      svg.append(t);
    }
    const ends = [];
    for (const ser of o.series) {
      const d = ser.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      svg.append(s('path', { d, class: `line ${ser.cls}` }));
      const last = ser.values.length - 1;
      ends.push({ ser, y: y(ser.values[last]), x: x(last) });
    }
    // étiquettes directes en bout de courbe (décalées si elles se chevauchent)
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) {
      svg.append(s('circle', { cx: e.x, cy: y(e.ser.values[e.ser.values.length - 1]), r: 4, class: `dot ${e.ser.cls}` }));
      const t = s('text', { x: e.x + 8, y: e.y + 4, class: 'label' });
      t.textContent = e.ser.name;
      svg.append(t);
    }
    // calque de survol
    const cross = s('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' });
    const marks = o.series.map((ser) => {
      const c = s('circle', { r: 5, class: `dot ${ser.cls}`, visibility: 'hidden' });
      svg.append(c);
      return c;
    });
    svg.append(cross);
    const hit = s('rect', { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: 'transparent' });
    svg.append(hit);
    const tip = h('div', { class: 'chart-tip' });
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      o.series.forEach((ser, k) => {
        marks[k].setAttribute('cx', x(i));
        marks[k].setAttribute('cy', y(ser.values[i]));
        marks[k].setAttribute('visibility', 'visible');
      });
      clear(tip);
      tip.append(h('div', { class: 'tt-title' }, o.xLabel(i)));
      for (const ser of o.series) {
        tip.append(h('div', { class: 'tt-row' }, h('i', { class: `sw ${ser.cls}` }), `${ser.name} `, h('b', null, ser.values[i])));
      }
      tip.style.display = 'block';
      const left = (x(i) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(left, 60), r.width - 60)}px`;
    };
    const leave = () => {
      cross.setAttribute('visibility', 'hidden');
      for (const mk of marks) mk.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);

    const legend = h('div', { class: 'legend' },
      o.series.map((ser) => h('span', null, h('i', { class: `sw ${ser.cls}` }), ser.name)),
      o.target ? h('span', null, h('i', { class: 'sw target' }), `Objectif ${o.target}`) : null);
    box.append(legend, h('div', { class: 'chart-wrap' }, svg, tip));
  };
  draw();
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = box.clientWidth;
    const ro = new ResizeObserver(() => {
      if (!box.isConnected) { ro.disconnect(); return; }
      if (Math.abs(box.clientWidth - lastW) > 4) { lastW = box.clientWidth; draw(); }
    });
    ro.observe(box);
  }
}
