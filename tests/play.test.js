import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, heuristicPlay } from '../js/ai.js';

const T = (...pairs) => pairs.map(([seat, card]) => ({ seat, card }));
const done = (leader, cards, winner, points = 0) => ({ leader, cards: T(...cards), winner, points });

const base = (over) => ({
  seat: 0,
  hand: [],
  trick: [],
  tricks: [],
  contract: { seat: 0, team: 0, value: 80, trump: 'H', mult: 1 },
  handCounts: [8, 8, 8, 8],
  ...over,
});

test('obligation de monter non respectée : plafond d\'atout', () => {
  // atout ♥ demandé, Est met le 9, Nord (partenaire d'Est ? non : Nord = siège 2) joue le 7 sous le 9
  const info = analyze(base({
    hand: ['AS', '8S', '7C', '8C', '7D', '8D', 'KS'],
    tricks: [done(1, [[1, '9H'], [2, '7H'], [3, '8H'], [0, 'QH']], 1, 17)],
  }));
  // Nord (2) a joué plus bas alors qu'Est menait au 9 : il n'a pas le valet
  assert.ok(info.ceil[2].H !== undefined);
  assert.equal(info.ceilCard[2].H, '9H');
});

test('10 sec : grosse carte donnée à l\'adversaire sans prendre', () => {
  const info = analyze(base({
    contract: { seat: 1, team: 1, value: 80, trump: 'H', mult: 1 },
    hand: ['7S', '8S', '7C', '8C', '7D', '8D', 'KC'],
    tricks: [done(0, [[0, 'AS'], [1, 'TS'], [2, '9S'], [3, 'QS']], 0, 24)],
  }));
  assert.ok(info.probVoid[1].has('S'));
  assert.ok(!info.probVoid[2].has('S')); // le partenaire du gagnant peut charger
});

test('appel direct et contre-appel lus dans les défausses', () => {
  const trickCards = [[0, 'AD'], [1, '7D'], [2, '7C'], [3, '8D']]; // Nord ne fournit pas, son partenaire est maître
  // contrat à 80 : appel direct → Nord promet l'as de ♣
  let info = analyze(base({
    seat: 1, hand: ['9S', '8S', '7S', 'TS', 'KD', 'QD', '9D'],
    tricks: [done(0, trickCards, 0, 11)],
  }));
  assert.equal(info.signals[2].mode, 'direct');
  assert.ok(info.likely[2].has('AC'));
  // contrat à 110 de l'équipe de Nord : contre-appel → Nord n'a pas l'as de ♣
  info = analyze(base({
    seat: 1, hand: ['9S', '8S', '7S', 'TS', 'KD', 'QD', '9D'],
    contract: { seat: 0, team: 0, value: 110, trump: 'H', mult: 1 },
    tricks: [done(0, trickCards, 0, 11)],
  }));
  assert.equal(info.signals[2].mode, 'counter');
  assert.ok(info.notHave[2].has('AC'));
  // la défense appelle toujours directement, même à 110
  info = analyze(base({
    seat: 0, hand: ['9S', '8S', '7S', 'TS', 'KD', 'QD', '9C'],
    contract: { seat: 1, team: 1, value: 110, trump: 'H', mult: 1 },
    tricks: [done(0, trickCards, 0, 11)],
  }));
  assert.equal(info.signals[2].mode, 'direct');
});

test('l\'équipe preneuse fait tomber les atouts avec son atout maître', () => {
  const r = heuristicPlay(base({ hand: ['JH', '7H', '8H', 'AS', '7S', 'AC', '7D', '8D'] }));
  assert.equal(r.card, 'JH');
  assert.match(r.reason, /tomber les atouts/);
});

test('partenaire au valet d\'atout (montré aux enchères) : on entame petit atout', () => {
  const r = heuristicPlay(base({
    hand: ['8H', '7H', 'AS', '7S', 'AC', '7D', '8D', 'KC'],
    contract: { seat: 2, team: 0, value: 90, trump: 'H', mult: 1 },
    auction: [{ seat: 2, type: 'bid', value: 90, trump: 'H' }, { seat: 3, type: 'pass' }, { seat: 0, type: 'pass' }, { seat: 1, type: 'pass' }],
    dealer: 1,
  }));
  assert.equal(r.card, '7H');
  assert.match(r.reason, /petit atout/);
});

test('partenaire maître : on charge une carte d\'au moins 3 points', () => {
  const r = heuristicPlay(base({ hand: ['AS', '7S', '8C', '9C', '7H', '8H', 'QC'], trick: T([2, 'AD'], [3, '7D']) }));
  assert.equal(r.card, 'QC');
});

test('défausse : appel direct avec l\'as, contre-appel au-dessus du seuil', () => {
  // Nord (2) entame l'as de ♦, Est fournit, Sud (0) n'a pas de ♦ : partenaire maître
  const trick = T([2, 'AD'], [3, '7D']);
  const hand = ['AS', '7S', '8C', '9C', '7H', '8H', '7C'];
  let r = heuristicPlay(base({ hand, trick, tricks: [], contract: { seat: 0, team: 0, value: 80, trump: 'H', mult: 1 } }));
  assert.equal(r.card, '7S');
  assert.match(r.reason, /Appel/);
  r = heuristicPlay(base({ hand, trick, contract: { seat: 0, team: 0, value: 110, trump: 'H', mult: 1 } }));
  assert.ok(['7C', '8C', '9C'].includes(r.card), r.card);
  assert.match(r.reason, /Contre-appel/);
});

test('on rejoue la couleur appelée par le partenaire', () => {
  // la défense (équipe 0) a la main ; Nord a appelé à ♠ lors d'un pli précédent
  const r = heuristicPlay(base({
    hand: ['9S', '8S', 'KD', '7C', '8C', '9D'],
    contract: { seat: 1, team: 1, value: 80, trump: 'H', mult: 1 },
    tricks: [
      done(1, [[1, 'AC'], [2, '7S'], [3, 'KC'], [0, 'QC']], 1, 18),
      done(1, [[1, 'AD'], [2, 'TD'], [3, '7D'], [0, '8D']], 0, 21),
    ],
  }));
  assert.equal(r.card, '8S');
  assert.match(r.reason, /appelé à ♠/);
});

test('tirages Monte-Carlo pondérés par les déductions', async () => {
  const { sampleHands, cardWeights, monteCarloPlay } = await import('../js/ai.js');
  const { makeRng } = await import('../js/cards.js');
  // Sud entame l'as de ♠, Est donne le 10 : Est n'a probablement plus de ♠.
  // Atout ♥ demandé ensuite : Nord joue le 7 sous le 9 d'Ouest, il n'a donc ni le valet ni le 9.
  const ctx = base({
    contract: { seat: 1, team: 1, value: 80, trump: 'H', mult: 1 },
    hand: ['8S', '7C', '8C', '9C', '7D', '8D'],
    tricks: [
      done(0, [[0, 'AS'], [1, 'TS'], [2, '7S'], [3, 'QS']], 0, 24),
      done(0, [[0, '8H'], [1, 'AH'], [2, '7H'], [3, '9H']], 3, 25),
    ],
    handCounts: [6, 6, 6, 6],
  });
  const info = analyze(ctx);
  const W = cardWeights(ctx, info);
  assert.ok(W[1].get('KS') < 0.2, 'poids réduit pour Est à ♠');
  const rand = makeRng(9);
  let eastSpades = 0;
  let northSpades = 0;
  for (let i = 0; i < 300; i++) {
    const hands = sampleHands(ctx, info, rand, W);
    assert.ok(!hands[2].includes('JH'), 'plafond respecté : Nord n\'a pas le valet d\'atout');
    eastSpades += hands[1].filter((c) => c[1] === 'S').length;
    northSpades += hands[2].filter((c) => c[1] === 'S').length;
  }
  assert.ok(eastSpades * 4 < northSpades, `Est reçoit rarement du ♠ (${eastSpades} contre ${northSpades})`);
  // le Monte-Carlo s'arrête au plus tard au nombre de donnes demandé et renvoie une carte jouable
  const r = monteCarloPlay({ ...ctx, seat: 0 }, { maxSamples: 60, budgetMs: 1e9, rand });
  assert.ok(ctx.hand.includes(r.card));
  assert.ok(!r.samples || r.samples <= 60);
});
