import test from 'node:test';
import assert from 'node:assert/strict';
import { newDeck, cardPoints, TOTAL_POINTS, LAST_TRICK_BONUS, sortHand } from '../js/cards.js';
import { legalCards, trickWinnerSeat, hasBelote, illegalReason } from '../js/rules.js';

const T = (...pairs) => pairs.map(([seat, card]) => ({ seat, card }));

test('le total des points vaut 162 pour chaque type de contrat', () => {
  for (const trump of ['H', 'D', 'S', 'C', 'NT', 'AT']) {
    const sum = newDeck().reduce((s, c) => s + cardPoints(c, trump), 0);
    assert.equal(sum + LAST_TRICK_BONUS, TOTAL_POINTS, trump);
  }
});

test('gagnant du pli : atout bat la couleur, ordre atout V>9>A', () => {
  assert.equal(trickWinnerSeat(T([0, 'AS'], [1, '7H'], [2, 'TS'], [3, 'KS']), 'H'), 1);
  assert.equal(trickWinnerSeat(T([0, 'AH'], [1, '9H'], [2, 'JH'], [3, 'TH']), 'H'), 2);
  assert.equal(trickWinnerSeat(T([0, 'TS'], [1, 'AS'], [2, 'JS'], [3, 'KD']), 'H'), 1);
  // la défausse ne gagne pas
  assert.equal(trickWinnerSeat(T([0, '7S'], [1, 'AD'], [2, '8S'], [3, 'AC']), 'H'), 2);
});

test('sans atout et tout atout', () => {
  assert.equal(trickWinnerSeat(T([0, 'JS'], [1, 'AS'], [2, '9S'], [3, 'TS']), 'NT'), 1);
  assert.equal(trickWinnerSeat(T([0, 'AS'], [1, '9S'], [2, 'JD'], [3, 'TS']), 'AT'), 1);
  assert.equal(trickWinnerSeat(T([0, 'AS'], [1, 'JS'], [2, '9S'], [3, 'TS']), 'AT'), 1);
});

test('obligation de fournir', () => {
  const hand = ['AS', '7S', 'JH', 'KD'];
  assert.deepEqual(legalCards(hand, T([3, 'TS']), 'H', 0).sort(), ['7S', 'AS']);
});

test('atout demandé : il faut monter si possible', () => {
  const hand = ['7H', 'AH', 'JH', 'KD'];
  assert.deepEqual(legalCards(hand, T([3, '9H']), 'H', 0).sort(), ['JH']);
  // impossible de monter : n'importe quel atout
  assert.deepEqual(legalCards(['7H', 'AH', 'KD'], T([3, 'JH']), 'H', 0).sort(), ['7H', 'AH']);
  // même si le partenaire est maître, on monte à l'atout
  assert.deepEqual(legalCards(hand, T([1, '8H'], [2, '9H']), 'H', 0).sort(), ['JH']);
});

test('pas la couleur : couper, surcouper, sous-couper, partenaire maître', () => {
  const hand = ['7H', 'AH', 'KD', '8C'];
  // adversaire maître, pas de coupe : on doit couper
  assert.deepEqual(legalCards(hand, T([3, 'AS']), 'H', 0).sort(), ['7H', 'AH']);
  // partenaire maître : libre
  assert.deepEqual(legalCards(hand, T([2, 'AS'], [3, '7S']), 'H', 0).sort(), hand.slice().sort());
  // adversaire a coupé au 10 : surcouper à l'as
  assert.deepEqual(legalCards(hand, T([2, 'AS'], [3, 'TH']), 'H', 0), ['AH']);
  // adversaire a coupé au valet : sous-couper obligatoire
  assert.deepEqual(legalCards(hand, T([2, 'AS'], [3, 'JH']), 'H', 0).sort(), ['7H', 'AH']);
  // pas d'atout : défausse libre
  assert.deepEqual(legalCards(['KD', '8C'], T([3, 'AS']), 'H', 0).sort(), ['8C', 'KD']);
});

test('tout atout : monter dans la couleur demandée', () => {
  assert.deepEqual(legalCards(['7S', 'JS', 'AS', 'KD'], T([3, '9S']), 'AT', 0), ['JS']);
  assert.deepEqual(legalCards(['7S', 'AS', 'KD'], T([3, '9S']), 'AT', 0).sort(), ['7S', 'AS']);
});

test('sans atout : simplement fournir', () => {
  assert.deepEqual(legalCards(['7S', 'AS', 'KD'], T([3, 'TS']), 'NT', 0).sort(), ['7S', 'AS']);
  assert.deepEqual(legalCards(['KD', '8C'], T([3, 'TS']), 'NT', 0).sort(), ['8C', 'KD']);
});

test('belote uniquement en contrat couleur', () => {
  assert.equal(hasBelote(['KH', 'QH', '7S'], 'H'), true);
  assert.equal(hasBelote(['KH', 'QH', '7S'], 'S'), false);
  assert.equal(hasBelote(['KH', 'QH', '7S'], 'AT'), false);
});

test('message d\'explication pour une carte refusée', () => {
  assert.match(illegalReason('KD', ['AS', 'KD'], T([3, 'TS']), 'H', 0), /fournir/);
  assert.match(illegalReason('KD', ['7H', 'KD'], T([3, 'TS']), 'H', 0), /couper/);
});

test('tri de la main : atout en premier', () => {
  const s = sortHand(['7S', 'JH', 'AD', '9H', 'KC'], 'H');
  assert.deepEqual(s.slice(0, 2), ['JH', '9H']);
});
