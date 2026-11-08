import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRound, gameWinner } from '../js/scoring.js';
import { CAPOT, GENERALE, newAuction, applyAuction, auctionOptions, auctionResult } from '../js/auction.js';

const C = (value, mult = 1, seat = 0) => ({ seat, team: seat % 2, value, trump: 'H', mult });
const tricks = (a, b) => [a, b, 0, 0]; // plis sièges 0 et 1

test('80 réussi avec 82 points', () => {
  const r = scoreRound({ contract: C(80), cardPoints: [82, 80], tricksBySeat: tricks(4, 4), beloteTeam: null });
  assert.equal(r.success, true);
  assert.deepEqual(r.score, [162, 80]);
});

test('80 chuté avec 81 points, même avec la belote', () => {
  const r = scoreRound({ contract: C(80), cardPoints: [81, 81], tricksBySeat: tricks(4, 4), beloteTeam: 0 });
  assert.equal(r.success, false);
  assert.deepEqual(r.score, [20, 240]);
});

test('la belote aide à remplir un contrat ≥ 90 mais pas sous 82', () => {
  let r = scoreRound({ contract: C(100), cardPoints: [85, 77], tricksBySeat: tricks(4, 4), beloteTeam: 0 });
  assert.equal(r.success, true);
  assert.deepEqual(r.score, [100 + 85 + 20, 77]);
  r = scoreRound({ contract: C(90), cardPoints: [75, 87], tricksBySeat: tricks(4, 4), beloteTeam: 0 });
  assert.equal(r.success, false);
});

test('belote de la défense toujours comptée pour elle', () => {
  const r = scoreRound({ contract: C(90), cardPoints: [95, 67], tricksBySeat: tricks(5, 3), beloteTeam: 1 });
  assert.equal(r.success, true);
  assert.deepEqual(r.score, [185, 87]);
});

test('coinche et surcoinche', () => {
  let r = scoreRound({ contract: C(100, 2), cardPoints: [110, 52], tricksBySeat: tricks(5, 3), beloteTeam: null });
  assert.deepEqual(r.score, [360, 0]);
  r = scoreRound({ contract: C(100, 4), cardPoints: [90, 72], tricksBySeat: tricks(5, 3), beloteTeam: 1 });
  assert.deepEqual(r.score, [0, 560 + 20]);
});

test('capot non annoncé compté 250', () => {
  const r = scoreRound({ contract: C(80), cardPoints: [162, 0], tricksBySeat: [5, 0, 3, 0], beloteTeam: null });
  assert.deepEqual(r.score, [330, 0]);
});

test('capot annoncé et générale', () => {
  let r = scoreRound({ contract: C(CAPOT), cardPoints: [162, 0], tricksBySeat: [5, 0, 3, 0], beloteTeam: null });
  assert.equal(r.success, true);
  assert.deepEqual(r.score, [412, 0]);
  r = scoreRound({ contract: C(CAPOT), cardPoints: [150, 12], tricksBySeat: [5, 1, 2, 0], beloteTeam: null });
  assert.equal(r.success, false);
  assert.deepEqual(r.score, [0, 410]);
  r = scoreRound({ contract: C(GENERALE), cardPoints: [162, 0], tricksBySeat: [6, 0, 2, 0], beloteTeam: null });
  assert.equal(r.success, false);
  r = scoreRound({ contract: C(GENERALE), cardPoints: [162, 0], tricksBySeat: [8, 0, 0, 0], beloteTeam: 0 });
  assert.equal(r.success, true);
  assert.deepEqual(r.score, [682, 0]);
});

test('fin de partie', () => {
  assert.equal(gameWinner([900, 400], 1000), null);
  assert.equal(gameWinner([1010, 400], 1000), 0);
  assert.equal(gameWinner([1010, 1100], 1000), 1);
  assert.equal(gameWinner([1100, 1100], 1000), null);
});

test('enchères : surenchère, 3 passes, coinche, surcoinche', () => {
  const a = newAuction(3); // premier à parler : 0
  applyAuction(a, 0, { type: 'bid', value: 80, trump: 'H' });
  assert.equal(auctionOptions(a, 1).minValue, 90);
  assert.equal(auctionOptions(a, 1).coinche, true);
  applyAuction(a, 1, { type: 'bid', value: 90, trump: 'S' });
  assert.equal(auctionOptions(a, 2).coinche, true);
  applyAuction(a, 2, { type: 'coinche' });
  // seuls les preneurs (1 et 3) peuvent surcoincher
  assert.equal(a.turn, 3);
  assert.equal(auctionOptions(a, 3).surcoinche, true);
  applyAuction(a, 3, { type: 'pass' });
  assert.equal(a.turn, 1);
  applyAuction(a, 1, { type: 'surcoinche' });
  assert.equal(a.finished, true);
  assert.deepEqual(auctionResult(a), {
    seat: 1, team: 1, value: 90, trump: 'S', mult: 4, coincheBy: 2, surcoincheBy: 1,
  });
});

test('enchères : quatre passes = redonne, trois passes après une enchère = fin', () => {
  let a = newAuction(0);
  for (const s of [1, 2, 3, 0]) applyAuction(a, s, { type: 'pass' });
  assert.equal(a.finished, true);
  assert.equal(auctionResult(a), null);
  a = newAuction(0);
  applyAuction(a, 1, { type: 'pass' });
  applyAuction(a, 2, { type: 'bid', value: 120, trump: 'NT' });
  for (const s of [3, 0, 1]) applyAuction(a, s, { type: 'pass' });
  assert.equal(a.finished, true);
  assert.equal(auctionResult(a).value, 120);
  assert.throws(() => applyAuction(newAuction(0), 1, { type: 'bid', value: 85, trump: 'H' }));
});
