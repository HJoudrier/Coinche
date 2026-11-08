// Écran « Revoir la donne » : mains de départ, enchères, plis et rejeu pas à pas.
import { h, clear, cardEl, openPanel, segmented } from './dom.js';
import { renderBidText, auctionListEl } from './render.js';
import { teamOf, partnerOf, sortHand } from '../cards.js';
import { contractLabel } from '../auction.js';
import { explainAuction } from '../reading.js';
import { replayState } from '../replay.js';

const REL = ['bottom', 'right', 'top', 'left'];
const AUTO_DELAY = 900;

/**
 * @param {object[]} history  enregistrements des manches de la partie
 * @param {number} index      manche à afficher (0 = première)
 * @param {{names: string[], mySeat: number}} o
 */
export function openReview(history, index, { names, mySeat }) {
  const st = { index: Math.max(0, Math.min(history.length - 1, index)), tab: 'hands', step: 0, timer: null };
  const body = h('div', { class: 'review' });
  const stopAuto = () => { if (st.timer) clearInterval(st.timer); st.timer = null; };
  const panel = openPanel('Revoir la donne', body, { onClose: stopAuto });
  const order = [mySeat, partnerOf(mySeat), (mySeat + 1) % 4, (mySeat + 3) % 4];
  const role = (s) => (s === mySeat ? 'vous' : s === partnerOf(mySeat) ? 'partenaire' : 'adversaire');
  const us = teamOf(mySeat);

  const draw = () => {
    stopAuto();
    clear(body);
    const r = history[st.index];
    const good = r.contract.team === us ? r.success : !r.success;
    const nav = h('div', { class: 'rv-nav' },
      h('button', {
        class: 'icon-btn', 'aria-label': 'Manche précédente', disabled: st.index === 0,
        onClick: () => { st.index--; st.step = 0; draw(); },
      }, '◀'),
      h('div', { class: 'rv-title' },
        h('b', null, `Manche ${r.round}`),
        h('div', { class: 'small' }, `${names[r.contract.seat]} · `, renderBidText(contractLabel(r.contract)), ' · ',
          h('span', { class: good ? 'ok' : 'ko' }, r.success ? 'réussi' : 'chuté'))),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Manche suivante', disabled: st.index >= history.length - 1,
        onClick: () => { st.index++; st.step = 0; draw(); },
      }, '▶'));
    const tabs = segmented([['hands', 'Mains'], ['auction', 'Enchères'], ['tricks', 'Plis'], ['replay', 'Rejeu']], st.tab,
      (v) => { st.tab = v; drawTab(); }, { small: true });
    const content = h('div', { class: 'rv-content' });
    body.append(nav, tabs, content);
    const drawTab = () => {
      stopAuto();
      clear(content);
      if (st.tab === 'hands') content.append(handsTab(r));
      else if (st.tab === 'auction') content.append(auctionTab(r));
      else if (st.tab === 'tricks') content.append(tricksTab(r));
      else content.append(replayTab(r));
    };
    drawTab();
  };

  const badges = (r, s) => [
    r.dealer === s ? h('span', { class: 'badge dealer', title: 'Donneur' }, 'D') : null,
    r.contract.seat === s ? h('span', { class: 'badge taker', title: 'Preneur' }, '★') : null,
    r.beloteSeat === s ? h('span', { class: 'badge belote', title: 'Belote' }, 'B') : null,
  ];
  const nameLine = (r, s, extra = null) => h('div', { class: `rv-name ${teamOf(s) === us ? 'us' : 'them'}` },
    h('b', null, names[s]), h('span', { class: 'muted small' }, ` · ${role(s)}`), ...badges(r, s), extra);

  function handsTab(r) {
    const wrap = h('div', { class: 'rv-hands' });
    for (const s of order) {
      wrap.append(h('div', { class: 'rv-hand' },
        nameLine(r, s),
        h('div', { class: 'rv-cards' }, sortHand(r.hands[s], r.contract.trump).map((c) => cardEl(c, { class: 'mini' })))));
    }
    wrap.append(h('p', { class: 'muted small' }, 'D = donneur · ★ = preneur · B = belote'));
    return wrap;
  }

  function auctionTab(r) {
    const leader = (r.dealer + 1) % 4;
    return h('div', null,
      h('p', { class: 'muted small' }, `${names[leader]} a parlé en premier et a entamé la manche.`),
      auctionListEl(explainAuction(r.auction || [], names, leader), names, mySeat));
  }

  function noTricks() {
    return h('p', { class: 'muted' }, 'Les plis ne sont pas disponibles pour cette manche (partie sauvegardée avec une version précédente).');
  }

  function tricksTab(r) {
    if (!r.tricks || !r.tricks.length) return noTricks();
    const wrap = h('div', { class: 'rv-tricks' });
    const cum = [0, 0];
    r.tricks.forEach((t, i) => {
      cum[teamOf(t.winner)] += t.points;
      wrap.append(h('div', { class: `rv-trick ${teamOf(t.winner) === us ? 'us' : 'them'}` },
        h('div', { class: 'rv-trick-head' },
          h('b', null, `Pli ${i + 1}`), h('span', { class: 'muted small' }, ` · entame ${names[t.leader]}`),
          h('span', { class: 'rv-cum' }, `Nous ${cum[us]} · Eux ${cum[1 - us]}`)),
        h('div', { class: 'rv-trick-cards' }, t.cards.map(({ seat, card }) => h('div', { class: `rv-tc ${seat === t.winner ? 'win' : ''}` },
          cardEl(card, { class: 'mini' }), h('span', { class: 'rv-tc-name' }, names[seat])))),
        h('div', { class: 'small rv-trick-foot' },
          `Remporté par ${names[t.winner]} · ${t.points} pts${i === r.tricks.length - 1 ? ' (dont 10 de der)' : ''}`)));
    });
    return wrap;
  }

  function replayTab(r) {
    if (!r.tricks || !r.tricks.length) return noTricks();
    const wrap = h('div', { class: 'rv-replay' });
    const table = h('div', { class: 'rv-table' });
    const trickEl = h('div', { class: 'trick' });
    const seats = REL.map((pos) => h('div', { class: `rv-seat ${pos}` }));
    table.append(trickEl, ...seats);
    const counter = h('div', { class: 'rv-counter' });
    const score = h('div', { class: 'rv-score small' });
    const handsEl = h('div', { class: 'rv-hands' });
    const autoBtn = h('button', { class: 'btn small', 'aria-label': 'Lecture automatique' }, '⏯');
    const go = (k) => { st.step = Math.max(0, Math.min(32, k)); render(); };
    const controls = h('div', { class: 'rv-controls' },
      h('button', { class: 'btn small', 'aria-label': 'Début', onClick: () => { stopAuto(); go(0); } }, '⏮'),
      h('button', { class: 'btn small', 'aria-label': 'Carte précédente', onClick: () => { stopAuto(); go(st.step - 1); } }, '◀'),
      autoBtn,
      h('button', { class: 'btn small', 'aria-label': 'Carte suivante', onClick: () => { stopAuto(); go(st.step + 1); } }, '▶'),
      h('button', {
        class: 'btn small', 'aria-label': 'Pli suivant',
        onClick: () => { stopAuto(); go(st.step % 4 === 0 ? st.step + 4 : Math.ceil(st.step / 4) * 4); },
      }, '⏭'));
    autoBtn.addEventListener('click', () => {
      if (st.timer) { stopAuto(); render(); return; }
      if (st.step >= 32) st.step = 0;
      st.timer = setInterval(() => {
        if (st.step >= 32) { stopAuto(); render(); return; }
        go(st.step + 1);
      }, AUTO_DELAY);
      render();
    });
    wrap.append(table, counter, controls, score, handsEl);

    function render() {
      const rs = replayState(r, st.step);
      autoBtn.textContent = st.timer ? '⏸' : '⏯';
      // places autour de la table
      for (let s = 0; s < 4; s++) {
        const rel = (s - mySeat + 4) % 4;
        const el = seats[rel];
        clear(el);
        el.className = `rv-seat ${REL[rel]} ${teamOf(s) === us ? 'us' : 'them'} ${rs.complete && rs.winner === s ? 'win' : ''}`;
        el.append(h('b', null, names[s]));
        if (rs.belote && rs.last && rs.last.seat === s) el.append(h('span', { class: 'bubble show belote' }, rs.belote));
      }
      // pli en cours
      clear(trickEl);
      for (const { seat, card } of rs.trick) {
        const rel = (seat - mySeat + 4) % 4;
        const last = rs.last && rs.last.card === card;
        const won = rs.complete && rs.winner === seat;
        trickEl.append(cardEl(card, { class: `pos-${rel} ${last ? 'last' : ''} ${won ? 'won' : ''}` }));
      }
      // compteur et score
      clear(counter);
      if (st.step === 0) counter.append('Début de la manche : ', h('b', null, names[(r.dealer + 1) % 4]), ' entame.');
      else {
        counter.append(`Pli ${rs.trickIndex + 1}/8 · carte ${rs.trick.length}/4`);
        if (rs.complete) counter.append(h('span', { class: 'rv-won' }, ` — ${names[rs.winner]} remporte ${rs.trickPoints} pts`));
      }
      clear(score);
      const won = [rs.tricksWon[us] + rs.tricksWon[us + 2], rs.tricksWon[1 - us] + rs.tricksWon[3 - us]];
      score.append(`Points : nous ${rs.cardPoints[us]} · eux ${rs.cardPoints[1 - us]} — plis : ${won[0]} / ${won[1]}`);
      // mains restantes
      clear(handsEl);
      for (const s of order) {
        handsEl.append(h('div', { class: 'rv-hand' },
          nameLine(r, s, h('span', { class: 'muted small' }, ` · ${rs.hands[s].length} carte${rs.hands[s].length > 1 ? 's' : ''}`)),
          h('div', { class: 'rv-cards' }, sortHand(rs.hands[s], r.contract.trump).map((c) => cardEl(c, { class: 'mini' })))));
      }
    }
    render();
    return wrap;
  }

  draw();
  return panel;
}
