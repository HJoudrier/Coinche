import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getView } from '../js/engine.js';
import { chooseCard } from '../js/ai.js';
import { chooseBid } from '../js/bidding.js';
import { makeRng, teamOf } from '../js/cards.js';
import { replaySteps, replayState } from '../js/replay.js';

/** Joue des manches entre robots jusqu'à obtenir `n` manches terminées. */
function playRounds(seed, n) {
  const rand = makeRng(seed);
  const state = createGame({ seed, target: 5000 });
  while (state.history.length < n) {
    if (state.phase === 'roundEnd') { applyAction(state, null, { type: 'next' }); continue; }
    const seat = state.turn;
    const v = getView(state, seat);
    const a = state.phase === 'bidding' ? chooseBid(v, 'medium', rand) : { type: 'play', card: chooseCard(v, 'medium', rand) };
    assert.ok(applyAction(state, seat, a).ok);
  }
  return state.history;
}

test('chaque manche enregistre ses 8 plis, cohérents avec les points et les plis par joueur', () => {
  for (const r of playRounds(11, 5)) {
    assert.equal(r.tricks.length, 8);
    assert.equal(replaySteps(r).length, 32);
    const pts = [0, 0];
    const bySeat = [0, 0, 0, 0];
    for (const t of r.tricks) { pts[teamOf(t.winner)] += t.points; bySeat[t.winner]++; }
    assert.deepEqual(pts, r.cardPoints);
    assert.deepEqual(bySeat, r.tricksBySeat);
    // toutes les cartes jouées viennent des mains de départ
    const all = new Set(r.hands.flat());
    for (const s of replaySteps(r)) assert.ok(all.has(s.card));
  }
});

test('rejeu pas à pas : début, premier pli, fin', () => {
  const [r] = playRounds(23, 1);
  const s0 = replayState(r, 0);
  assert.deepEqual(s0.hands, r.hands);
  assert.equal(s0.trick.length, 0);
  assert.deepEqual(s0.cardPoints, [0, 0]);

  const s4 = replayState(r, 4);
  assert.equal(s4.trick.length, 4);
  assert.equal(s4.complete, true);
  assert.equal(s4.winner, r.tricks[0].winner);
  assert.equal(s4.cardPoints[teamOf(r.tricks[0].winner)], r.tricks[0].points);
  assert.equal(s4.hands.reduce((n, h) => n + h.length, 0), 28);

  const s5 = replayState(r, 5);
  assert.equal(s5.trickIndex, 1);
  assert.equal(s5.trick.length, 1);
  assert.equal(s5.trick[0].seat, r.tricks[0].winner);

  const end = replayState(r, 32);
  assert.ok(end.hands.every((h) => h.length === 0));
  assert.deepEqual(end.cardPoints, r.cardPoints);
  assert.equal(replayState(r, 99).step, 32);
});

test('belote et rebelote signalées pendant le rejeu', () => {
  const rounds = playRounds(5, 30);
  const r = rounds.find((x) => x.beloteSeat !== null);
  assert.ok(r, 'une manche avec belote');
  const said = [];
  for (let k = 1; k <= 32; k++) {
    const st = replayState(r, k);
    if (st.belote) said.push(st.belote);
  }
  assert.deepEqual(said, ['Belote', 'Rebelote']);
});
