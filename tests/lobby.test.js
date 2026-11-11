// Salon : places libres, choix de la place par un invité, présentation de la table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lobbyFreeSeats, gameFreeSeats, placement, lobbyTable, gameTable, partnerOf,
} from '../js/lobby.js';

const lobby = (kinds, guests = {}) => ({ kinds: ['local', ...kinds], guests });

test('places libres du salon : réservées à un invité et inoccupées, partenaire d\'abord', () => {
  assert.deepEqual(lobbyFreeSeats(lobby(['remote', 'remote', 'remote'])), [2, 1, 3]);
  assert.deepEqual(lobbyFreeSeats(lobby(['robot', 'robot', 'robot'])), []);
  assert.deepEqual(lobbyFreeSeats(lobby(['remote', 'robot', 'remote'], { 3: { name: 'Zoé' } })), [1]);
});

test('en cours de partie, seule une place d\'invité absente tenue par un robot est libre', () => {
  const seats = [
    { kind: 'local', name: 'Moi' },
    { kind: 'remote', name: 'Est', connected: false, standIn: true },
    { kind: 'remote', name: 'Nord', connected: false, standIn: false }, // absent : la table l'attend
    { kind: 'robot', name: 'Ouest' },
  ];
  assert.deepEqual(gameFreeSeats(seats), [1]);
});

test('placement : seule place libre ou ancienne place → assis d\'office ; plusieurs → il choisit ; aucune → complet', () => {
  assert.deepEqual(placement([]), { full: true });
  assert.deepEqual(placement([1]), { seat: 1 });
  assert.deepEqual(placement([2, 1, 3]), { choose: true });
  assert.deepEqual(placement([2, 1, 3], 1), { seat: 1 });
  assert.deepEqual(placement([2, 3], 1), { choose: true }, 'son ancienne place n\'est plus libre');
});

test('la table montre l\'hôte, les robots, les invités installés et les places libres', () => {
  const t = lobbyTable(lobby(['remote', 'remote', 'robot'], { 2: { name: 'Léa' } }), 'Hugo');
  assert.deepEqual(t.map((s) => [s.label, s.kind, s.name, s.free]), [
    ['Sud', 'host', 'Hugo', false],
    ['Est', 'guest', null, true],
    ['Nord', 'guest', 'Léa', false],
    ['Ouest', 'robot', 'Robot', false],
  ]);
  // le tableau reste du JSON simple, envoyé tel quel à l'invité
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
});

test('en partie, la place libre rappelle son ancien occupant', () => {
  const t = gameTable([
    { kind: 'local', name: 'Moi' },
    { kind: 'remote', name: 'Bob', connected: false, standIn: true },
    { kind: 'remote', name: 'Cam', connected: true },
    { kind: 'robot', name: 'Ouest' },
  ]);
  assert.equal(t[1].free, true);
  assert.equal(t[1].replaced, true);
  assert.equal(t[1].name, 'Bob');
  assert.equal(t[2].free, false);
});

test('partenaire d\'une place : celle d\'en face', () => {
  const t = lobbyTable(lobby(['remote', 'remote', 'robot'], { 1: { name: 'Max' } }), 'Hugo');
  assert.deepEqual(partnerOf(t, 2), { kind: 'human', text: 'Hugo' }); // Nord avec Sud (l'hôte)
  assert.deepEqual(partnerOf(t, 3), { kind: 'human', text: 'Max' }); // Ouest avec Est
  assert.deepEqual(partnerOf(t, 1), { kind: 'robot', text: 'un robot' });
  assert.deepEqual(partnerOf(t, 0), { kind: 'free', text: 'une place libre' });
});
