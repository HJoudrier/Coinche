import test from 'node:test';
import assert from 'node:assert/strict';
import { newAuction, applyAuction, auctionOptions } from '../js/auction.js';
import { analyzeBid, chooseBid, explainAuction, openingValue, sureTricksNT } from '../js/bidding.js';

const NAMES = ['Sud', 'Est', 'Nord', 'Ouest'];

/** Vue minimale d'enchères pour `seat` après les actions [[siège, action], ...]. */
function viewFor(hand, seat, actions = [], dealer = 3) {
  const a = newAuction(dealer);
  for (const [s, act] of actions) applyAuction(a, s, act);
  assert.equal(a.turn, seat, 'ce doit être au tour du siège testé');
  return { hand, seat, dealer, auction: a, options: auctionOptions(a, seat), names: NAMES };
}
const bid = (value, trump) => ({ type: 'bid', value, trump });
const pass = { type: 'pass' };

test('ouverture à 80 avec le valet et 4 atouts (sans le 9)', () => {
  const v = viewFor(['JH', '8H', '7H', 'TH', '7S', '8S', '9C', '8D'], 0);
  assert.deepEqual(chooseBid(v), bid(80, 'H'));
});

test('ouverture à 80 avec le 9 et 5 atouts (sans le valet)', () => {
  const v = viewFor(['9S', '7S', '8S', 'QS', 'TS', '7H', '8D', '7C'], 0);
  assert.deepEqual(chooseBid(v), bid(80, 'S'));
});

test('9 troisième sans as : passe', () => {
  const v = viewFor(['9S', '7S', '8S', '7H', '8H', 'KD', '7C', '8C'], 0);
  assert.deepEqual(chooseBid(v), pass);
});

test('valet + 9 avec 4 atouts : 90 ; avec l\'as d\'atout : 100', () => {
  assert.deepEqual(chooseBid(viewFor(['JH', '9H', '7H', '8H', '7S', '8S', '7C', '8D'], 0)), bid(90, 'H'));
  assert.deepEqual(chooseBid(viewFor(['JH', '9H', 'AH', '8H', '7S', '8S', '7C', '8D'], 0)), bid(100, 'H'));
  assert.equal(openingValue(['JH', '9H', '7H', '7S', '8S', '7C', '8C', '8D'], 'H').value, 80);
});

test('barrage avec 6 atouts dont le valet', () => {
  const v = viewFor(['JH', '7H', '8H', 'QH', 'KH', 'TH', '7S', '8C'], 0);
  assert.deepEqual(chooseBid(v), bid(110, 'H'));
});

test('les as ne comptent pas dans la première annonce, ils viennent au second tour', () => {
  const hand = ['JH', '7H', '8H', 'TH', 'AS', 'AC', '7D', '8D'];
  assert.deepEqual(chooseBid(viewFor(hand, 0)), bid(80, 'H'));
  // Nord soutient (+10), puis Sud annonce ses deux as (+20)
  const v = viewFor(hand, 0, [[0, bid(80, 'H')], [1, pass], [2, bid(90, 'H')], [3, pass]]);
  const a = analyzeBid(v);
  assert.deepEqual(a.action, bid(110, 'H'));
  assert.match(a.explanation, /Second tour/);
});

test('soutien du partenaire : +10 par carte utile', () => {
  // Nord (2) ouvre 80 ♥, Ouest passe, Sud a le 9 ♥ et l'as de ♠
  const v = viewFor(['9H', '7H', 'AS', '8S', '7C', '8C', '7D', '8D'], 0, [[2, bid(80, 'H')], [3, pass]], 1);
  assert.deepEqual(chooseBid(v), bid(100, 'H'));
  // sans carte utile : passe
  const v2 = viewFor(['7H', '8H', 'KS', '8S', '7C', '8C', '7D', '8D'], 0, [[2, bid(80, 'H')], [3, pass]], 1);
  const a2 = analyzeBid(v2);
  assert.deepEqual(a2.action, pass);
  assert.match(a2.explanation, /Rien pour soutenir/);
});

test('surenchère : jusqu\'à 20 au-dessus de son ouverture, pas au-delà', () => {
  const hand = ['JH', '8H', '7H', 'TH', '7S', '8S', '9C', '8D'];
  // Est (1) ouvre 80 ♠, Nord et Ouest passent : 90 ♥
  assert.deepEqual(chooseBid(viewFor(hand, 0, [[1, bid(80, 'S')], [2, pass], [3, pass]], 0)), bid(90, 'H'));
  // sur 90 ♠ : 100 ♥ (ouverture 80 + 20)
  assert.deepEqual(chooseBid(viewFor(hand, 0, [[1, bid(90, 'S')], [2, pass], [3, pass]], 0)), bid(100, 'H'));
  // sur 100 ♠ : passe
  assert.equal(chooseBid(viewFor(hand, 0, [[1, bid(100, 'S')], [2, pass], [3, pass]], 0)).type, 'pass');
});

test('ouvertures courtes : valet troisième avec un as, 9 quatrième, 9 troisième avec deux as', () => {
  assert.deepEqual(chooseBid(viewFor(['JH', '8H', '7H', 'AS', '8S', '9C', '8D', '7D'], 0)), bid(80, 'H'));
  assert.equal(chooseBid(viewFor(['JH', '8H', '7H', 'KS', '8S', '9C', '8D', '7D'], 0)).type, 'pass');
  assert.deepEqual(chooseBid(viewFor(['9H', '8H', '7H', 'QH', '8S', '9C', '8D', '7D'], 0)), bid(80, 'H'));
  assert.deepEqual(chooseBid(viewFor(['9H', '8H', '7H', 'AS', 'AC', '9C', '8D', '7D'], 0)), bid(80, 'H'));
  assert.equal(chooseBid(viewFor(['9H', '8H', '7H', 'AS', 'KC', '9C', '8D', '7D'], 0)).type, 'pass');
});

test('les as qui ont servi à ouvrir ne sont pas réannoncés au second tour', () => {
  // 9 troisième + 2 as : ouverture 80 ; Nord soutient, Sud ne remonte pas pour ces deux as
  const hand = ['9H', '8H', '7H', 'AS', 'AC', '9C', '8D', '7D'];
  const v = viewFor(hand, 0, [[0, bid(80, 'H')], [1, pass], [2, bid(90, 'H')], [3, pass]]);
  assert.equal(chooseBid(v).type, 'pass');
});

test('en concurrence, on peut compter ses as', () => {
  const hand = ['JH', '8H', '7H', 'TH', 'AS', '8S', 'AC', '8D'];
  const v = viewFor(hand, 0, [[1, bid(100, 'S')], [2, pass], [3, pass]], 0);
  const a = analyzeBid(v);
  assert.deepEqual(a.action, bid(110, 'H'));
  assert.match(a.explanation, /concurrence/);
});

test('ouverture plus légère en dernière position', () => {
  const hand = ['JH', '8H', '7H', '7S', '8S', '9C', '8D', 'KD'];
  assert.deepEqual(chooseBid(viewFor(hand, 0)), pass);
  const v = viewFor(hand, 0, [[1, pass], [2, pass], [3, pass]], 0);
  assert.deepEqual(chooseBid(v), bid(80, 'H'));
});

test('signification des annonces', () => {
  const history = [
    { seat: 0, type: 'bid', value: 80, trump: 'H' },
    { seat: 1, type: 'pass' },
    { seat: 2, type: 'bid', value: 100, trump: 'H' },
    { seat: 3, type: 'bid', value: 120, trump: 'S' },
    { seat: 0, type: 'bid', value: 130, trump: 'H' },
    { seat: 1, type: 'coinche' },
  ];
  const ex = explainAuction(history, NAMES);
  assert.equal(ex.length, history.length);
  assert.match(ex[0].text, /Valet ou 9 de ♥/);
  assert.match(ex[1].text, /pas de couleur/i);
  assert.match(ex[2].text, /Soutien de Sud : \+20 = 2 cartes utiles/);
  assert.match(ex[3].text, /Barrage/);
  assert.match(ex[4].text, /Second tour : \+30/);
  assert.match(ex[5].text, /chuteront/);
  const ex2 = explainAuction([
    { seat: 1, type: 'bid', value: 80, trump: 'S' },
    { seat: 2, type: 'bid', value: 90, trump: 'H' },
    { seat: 3, type: 'pass' },
    { seat: 0, type: 'pass' },
  ], NAMES);
  assert.match(ex2[1].text, /Surenchère : valet ou 9 de ♥/);
  assert.match(ex2[3].text, /Rien pour soutenir Nord/);
});

test('sans atout : une longue couleur maîtresse compte en entier si l\'on entame', () => {
  const hand = ['AS', 'TS', 'KS', 'QS', '8S', '7S', '7H', '8D'];
  assert.equal(sureTricksNT(hand, 'NT', true).total, 6);
  assert.equal(sureTricksNT(hand, 'NT', false).total, 4);
  // Sud parle en premier (donneur Ouest) : il entame → 90 SA
  const a = analyzeBid(viewFor(hand, 0, [], 3));
  assert.deepEqual(a.action, bid(90, 'NT'));
  assert.match(a.explanation, /entamez/);
  // Sud parle en dernier : il n'entame pas, la longue ne compte que pour ses 4 maîtresses → passe
  const a2 = analyzeBid(viewFor(hand, 0, [[1, pass], [2, pass], [3, pass]], 0));
  assert.deepEqual(a2.action, pass);
});

test('tout atout avec beaucoup de cartes maîtresses', () => {
  const hand = ['JC', '9C', 'AC', 'TC', 'JD', '9D', 'JH', '7S'];
  assert.equal(sureTricksNT(hand, 'AT', false).total, 7);
  assert.deepEqual(chooseBid(viewFor(hand, 0, [], 3)), bid(110, 'AT'));
});

test('signification d\'un sans atout annoncé par celui qui entame', () => {
  const ex = explainAuction([{ seat: 0, type: 'bid', value: 90, trump: 'NT' }], NAMES, 0);
  assert.match(ex[0].text, /6 levées sûres/);
  assert.match(ex[0].text, /entame/);
  const ex2 = explainAuction([{ seat: 1, type: 'bid', value: 80, trump: 'AT' }], NAMES, 0);
  assert.doesNotMatch(ex2[0].text, /entame/);
});
