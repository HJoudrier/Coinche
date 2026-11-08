// Rendus partagés entre la table de jeu, les statistiques et la revue des donnes.
import { h } from './dom.js';
import { teamOf } from '../cards.js';

/** Texte avec symboles de couleur colorés. */
export function renderBidText(text) {
  const frag = document.createDocumentFragment();
  for (const part of String(text).split(/([♥♦♠♣])/)) {
    if (!part) continue;
    if ('♥♦'.includes(part)) frag.append(h('span', { class: 'suit red' }, part));
    else if ('♠♣'.includes(part)) frag.append(h('span', { class: 'suit' }, part));
    else frag.append(part);
  }
  return frag;
}

/** Liste des annonces avec leur signification (sortie de explainAuction). */
export function auctionListEl(meanings, names, mySeat) {
  const list = h('ol', { class: 'auction-list' });
  for (const m of meanings) {
    list.append(h('li', { class: `al-item ${m.type} ${teamOf(m.seat) === teamOf(mySeat) ? 'us' : 'them'}` },
      h('div', { class: 'al-head' }, h('b', null, names[m.seat]), h('span', { class: 'al-bid' }, renderBidText(m.label))),
      h('div', { class: 'al-text' }, renderBidText(m.text))));
  }
  return list;
}
