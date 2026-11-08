import test from 'node:test';
import assert from 'node:assert/strict';
import { newAuction, applyAuction, auctionOptions } from '../js/auction.js';
import { analyzeBid, chooseBid } from '../js/bidding.js';
import {
  auctionKnowledge, knownCards, describeKnowledge, explainAuction,
} from '../js/reading.js';
import { auctionForcedCards, auctionLengths } from '../js/ai.js';

const NAMES = ['Sud', 'Est', 'Nord', 'Ouest'];
const bid = (value, trump) => ({ type: 'bid', value, trump });
const pass = { type: 'pass' };

function viewFor(hand, seat, actions = [], dealer = 3) {
  const a = newAuction(dealer);
  for (const [s, act] of actions) applyAuction(a, s, act);
  assert.equal(a.turn, seat);
  return { hand, seat, dealer, auction: a, options: auctionOptions(a, seat), names: NAMES };
}

test('une ouverture à 90 révèle le valet et le 9, et 4 cartes', () => {
  const kn = auctionKnowledge([{ seat: 2, type: 'bid', value: 90, trump: 'H' }]);
  assert.ok(kn[2].has.has('JH') && kn[2].has.has('9H'));
  assert.equal(kn[2].minLen.H, 4);
});

test('80 = valet ou 9 : si l\'on tient l\'un, le partenaire a l\'autre', () => {
  const kn = auctionKnowledge([{ seat: 2, type: 'bid', value: 80, trump: 'H' }]);
  assert.deepEqual([...knownCards(kn, 2, ['JH', '7S'])], ['9H']);
  assert.deepEqual([...knownCards(kn, 2, ['7S'])], []);
  const lines = describeKnowledge([{ seat: 2, type: 'bid', value: 80, trump: 'H' }], NAMES, null, 0, ['JH']);
  assert.match(lines[0].text, /Nord \(partenaire\) : 9♥ \(vous avez V♥\), au moins 3 ♥/);
});

test('le partenaire montre V♥ 9♥ et l\'on a les trois autres valets : tout atout', () => {
  // donneur Est : Nord parle en premier
  const hand = ['JS', '9S', 'JD', 'JC', 'AS', '7H', '8D', '7C'];
  const v = viewFor(hand, 0, [[2, bid(90, 'H')], [3, pass]], 1);
  const a = analyzeBid(v);
  assert.deepEqual(a.action, bid(110, 'AT'));
  assert.match(a.explanation, /4 valets/);
  const ex = explainAuction([...v.auction.history, { seat: 0, type: 'bid', value: 110, trump: 'AT' }], NAMES, 2);
  assert.match(ex[2].text, /Passage à tout atout/);
  assert.deepEqual(ex[2].claim.has.sort(), ['JC', 'JD', 'JS']);
});

test('avec seulement deux autres valets, on reste dans la couleur du partenaire', () => {
  const hand = ['JS', '9S', 'JD', '7C', 'AS', '7H', '8D', '8C'];
  const v = viewFor(hand, 0, [[2, bid(90, 'H')], [3, pass]], 1);
  assert.deepEqual(chooseBid(v), bid(100, 'H'));
});

test('pas de sans atout sans as dans la couleur adverse', () => {
  // Sud entame et a 6 levées sûres à sans atout, mais Est a annoncé ♥ et Sud n'a pas l'as de ♥
  const hand = ['AS', 'TS', 'KS', 'QS', '8S', '7S', '7H', '8D'];
  const v = viewFor(hand, 0, [[1, bid(80, 'H')], [2, pass], [3, pass]], 0);
  assert.notEqual(chooseBid(v).trump, 'NT');
});

test('coinche contre un tout atout quand on a deux valets', () => {
  const hand = ['JS', 'JD', '9S', 'AS', '7H', '8H', '7C', '8C'];
  const v = viewFor(hand, 0, [[1, bid(90, 'AT')], [2, pass], [3, pass]], 0);
  const a = analyzeBid(v);
  assert.deepEqual(a.action, { type: 'coinche' });
  assert.match(a.explanation, /valets/);
});

test('le jeu de la carte utilise les cartes et longueurs révélées par les enchères', () => {
  const ctx = {
    seat: 0,
    hand: ['7S', '8S', '9S', 'TS', '7D', '8D', '9D', 'TD'],
    trick: [],
    tricks: [],
    contract: { seat: 2, team: 0, value: 90, trump: 'H', mult: 1 },
    handCounts: [8, 8, 8, 8],
    auction: [{ seat: 2, type: 'bid', value: 90, trump: 'H' }, { seat: 3, type: 'pass' }, { seat: 0, type: 'pass' }, { seat: 1, type: 'pass' }],
    dealer: 1,
  };
  assert.deepEqual(auctionForcedCards(ctx), { JH: 2, '9H': 2 });
  assert.deepEqual(auctionLengths(ctx)[2], { H: { min: 4, max: 8 } });
});
