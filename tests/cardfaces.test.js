// Cartes du style « Classique » (vendor/cards) : présence, index dans les quatre coins,
// nombre de symboles conforme à un jeu traditionnel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SUITS, RANKS } from '../js/cards.js';

const read = (card) => fs.readFileSync(new URL(`../vendor/cards/${card}.svg`, import.meta.url), 'utf8');
const count = (svg, re) => (svg.match(re) || []).length;

test('les 32 cartes classiques existent et sont des SVG autonomes', () => {
  for (const s of SUITS) {
    for (const r of RANKS) {
      const svg = read(r + s);
      assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/, `${r}${s}`);
      assert.match(svg, /viewBox="-120 -168 240 336"/, `${r}${s}`);
      assert.ok(svg.endsWith('</svg>'), `${r}${s}`);
      assert.ok(!/www\.me\.uk|<script|<text/.test(svg), `${r}${s} : contenu inattendu`);
    }
  }
});

test('valeur et symbole dans les quatre coins', () => {
  for (const s of SUITS) {
    for (const r of RANKS) {
      const svg = read(r + s);
      assert.equal(count(svg, /<use [^>]*height="40" width="40"/g), 4, `${r}${s} : valeur`);
      assert.equal(count(svg, /<use [^>]*height="32" width="32"/g), 4, `${r}${s} : petit symbole`);
    }
  }
});

test('symboles disposés comme sur un vrai jeu : 1 pour l\'as, 7 à 10 pour les cartes basses', () => {
  const pips = { 7: 7, 8: 8, 9: 9, T: 10 };
  for (const s of SUITS) {
    assert.equal(count(read(`A${s}`), /<use [^>]*height="120"/g), 1, `A${s}`);
    for (const [r, n] of Object.entries(pips)) {
      assert.equal(count(read(r + s), /<use [^>]*height="70"/g), n, `${r}${s}`);
    }
  }
});

test('les figures sont illustrées et portent un index français (V, D, R)', () => {
  for (const s of SUITS) {
    for (const r of ['J', 'Q', 'K']) {
      const svg = read(r + s);
      assert.ok(count(svg, /height="260.8"/g) > 0, `${r}${s} : illustration`);
    }
    // tracé du V (pas de J anglais), du D et du R
    assert.ok(read(`J${s}`).includes('M-270-460h160m-90 10L0 460l200-910m-90-10h160'), `J${s}`);
    assert.ok(read(`Q${s}`).includes('c200 0 285 200 285 460s-85 460-285 460h-165'), `Q${s}`);
    assert.ok(read(`K${s}`).includes('a215 220 0 0 1 0 440h-225'), `K${s}`);
  }
});
