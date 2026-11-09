// Génère vendor/cards/*.svg (style « Classique ») à partir des cartes d'Adrian Kennard,
// domaine public, distribuées dans le paquet npm @letele/playing-cards (licence CC0).
//
// usage :
//   npm pack @letele/playing-cards && tar xzf letele-playing-cards-*.tgz
//   node tools/extract-cards.mjs package/dist/index.esm.js vendor/cards
//
// Adaptations pour la coinche :
//  - index français (V, D, R ; A, 10, 9, 8, 7) dans les quatre coins, un peu agrandis pour
//    rester lisibles sur téléphone, dessinés dans le style des index d'origine ;
//  - as : un grand symbole central (l'as de pique d'origine porte une publicité) ;
//  - contour retiré : la bordure et les coins arrondis sont dessinés par la feuille de style.
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] || 'package/dist/index.esm.js';
const raw = fs.readFileSync(input, 'utf8');
const src = raw.replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?\s*$/m, '');
const exportsLine = raw.match(/^export \{([^}]*)\}/m)[1];
const names = exportsLine.split(',').map((x) => x.trim().split(/\s+as\s+/)).map(([a, b]) => [a, b]);

const React = { createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() }) };
const _extends = Object.assign;
// eslint-disable-next-line no-new-func
const mod = new Function('React', '_extends', `${src}\nreturn {${names.map(([a]) => a).join(',')}};`)(React, _extends);

const KEEP = new Set(['viewBox', 'preserveAspectRatio', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'gradientUnits', 'gradientTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'spreadMethod',
  'textLength', 'lengthAdjust', 'startOffset', 'markerWidth', 'markerHeight', 'refX', 'refY', 'stdDeviation']);
const attrName = (k) => {
  if (KEEP.has(k)) return k;
  if (k === 'className') return 'class';
  if (k === 'xlinkHref') return 'xlink:href';
  if (k === 'xmlnsXlink') return 'xmlns:xlink';
  if (k.startsWith('aria')) return null;
  return k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
};
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function ser(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node !== 'object') return esc(node);
  const attrs = Object.entries(node.props)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'children' && k !== 'title' && k !== 'titleId')
    .map(([k, v]) => {
      const n = k === 'style' ? null : attrName(k);
      if (k === 'style' && typeof v === 'object') {
        return `style="${Object.entries(v).map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`).join(';')}"`;
      }
      return n ? `${n}="${esc(v)}"` : '';
    }).filter(Boolean).join(' ');
  const kids = node.children.map(ser).join('');
  return `<${node.tag}${attrs ? ` ${attrs}` : ''}>${kids}</${node.tag}>`;
}

const out = process.argv[3] || 'vendor/cards';
fs.mkdirSync(out, { recursive: true });
// cartes de la coinche : as, 7 à 10, valet, dame, roi
const RANKS = { a: 'A', 7: '7', 8: '8', 9: '9', 10: 'T', j: 'J', q: 'Q', k: 'K' };
// glyphes des figures en français, même tracé que les index d'origine (traits de 80, empattements)
const STEM = 'M-285-460h200m-100 0v920m-100 0h200';
const FRENCH = {
  J: 'M-270-460h160m-90 10L0 460l200-910m-90-10h160', // V
  Q: `${STEM}M-185-460h165c200 0 285 200 285 460s-85 460-285 460h-165`, // D
  K: `${STEM}M-185-460h225a215 220 0 0 1 0 440h-225M10-20l175 460M85 460h200`, // R
};
// index : valeur (boîte de 40) et petit symbole (boîte de 32), coin haut gauche ; le reste par symétrie
const INDEX_STROKE = 115;
const RANK_BOX = { x: -118, y: -164, s: 40 };
const SUIT_BOX = { x: -114, y: -123, s: 32 };
const use = (id, b, mirror) => `<use xlink:href="#${id}" height="${b.s}" width="${b.s}" x="${mirror ? -b.x - b.s : b.x}" y="${b.y}"></use>`;
const corners = (rid, sid) => {
  const two = `${use(rid, RANK_BOX)}${use(sid, SUIT_BOX)}${use(rid, RANK_BOX, true)}${use(sid, SUIT_BOX, true)}`;
  return `<g>${two}</g><g transform="rotate(180)">${two}</g>`;
};

const cards = {};
for (const [fn, exp] of names) {
  const suit = exp[0];
  const rank = RANKS[exp.slice(1).toLowerCase()];
  if (!'SHDC'.includes(suit) || !rank) continue;
  cards[rank + suit] = ser(mod[fn]({}));
}

let count = 0;
for (const [card, original] of Object.entries(cards)) {
  const rank = card[0];
  const suit = card[1];
  const red = suit === 'H' || suit === 'D';
  const rid = original.match(/<use xlink:href="#([^"]+)" height="32" width="32" x="-114.4" y="-156"/)[1];
  const sid = original.match(/<use xlink:href="#([^"]+)" height="26.769" width="26.769" x="-111.784" y="-119"/)[1];
  const symbol = (id) => original.match(new RegExp(`<symbol id="${id}"[^>]*>.*?</symbol>`))[0];
  let svg;
  if (rank === 'A') {
    // grand symbole central, sans rien d'autre
    const pip = symbol(sid);
    svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" preserveAspectRatio="none" viewBox="-120 -168 240 336"><defs>${symbol(rid)}${pip}</defs>`
      + `<use xlink:href="#${sid}" height="120" width="120" x="-60" y="-60"></use></svg>`;
  } else {
    svg = original
      .replace(/<use[^>]*height="32" width="32" x="-114.4" y="-156"[^>]*><\/use>/g, '')
      .replace(/<use[^>]*height="26.769" width="26.769" x="-111.784" y="-119"[^>]*><\/use>/g, '')
      .replace(/<rect width="239" height="335" x="-119.5" y="-167.5"[^>]*><\/rect>/, '')
      .replace(/ height="336"/, '').replace(/ width="240"/, '')
      .replace(/ class="[^"]*"/, '');
  }
  // valeur : tracé français pour les figures, trait plus épais pour la lecture en petit
  const d = FRENCH[rank] || symbol(rid).match(/<path d="([^"]+)"/)[1];
  const glyph = `<symbol id="${rid}" viewBox="-500 -500 1000 1000" preserveAspectRatio="xMinYMid"><path d="${d}" stroke="${red ? 'red' : '#000'}" stroke-width="${INDEX_STROKE}" stroke-linecap="square" stroke-miterlimit="1.5" fill="none"></path></symbol>`;
  svg = svg.replace(symbol(rid), glyph);
  svg = svg.replace(/<\/svg>$/, `${corners(rid, sid)}</svg>`);
  if (!svg.includes('xmlns:xlink')) svg = svg.replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  fs.writeFileSync(path.join(out, `${card}.svg`), svg);
  count++;
}
console.log(`${count} cartes écrites dans ${out}`);
