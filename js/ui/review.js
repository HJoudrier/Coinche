// Écran « Revoir la donne » : mains de départ, enchères, plis, rejeu pas à pas et analyse cartes sur table.
import {
  h, clear, append, cardEl, openPanel, segmented,
} from './dom.js';
import { renderBidText, auctionListEl } from './render.js';
import {
  teamOf, partnerOf, sortHand, cardLabel, SUIT_SYMBOL, SUIT_NAME,
} from '../cards.js';
import { contractLabel, bidLabel } from '../auction.js';
import { explainAuction } from '../reading.js';
import { replayState } from '../replay.js';
import { analyzeRoundAsync, bestScoresAsync } from '../mcclient.js';

const REL = ['bottom', 'right', 'top', 'left'];
const AUTO_DELAY = 900;
// analyses déjà lancées (par manche et par joueur)
const analysisCache = new WeakMap();
const scoresCache = new WeakMap();
const SCORE_TRUMPS = ['H', 'D', 'C', 'S', 'NT', 'AT'];

/**
 * @param {object[]} history  enregistrements des manches de la partie
 * @param {number} index      manche à afficher (0 = première)
 * @param {{names: string[], mySeat: number}} o
 */
export function openReview(history, index, { names, mySeat, tab = 'hands' }) {
  const st = { index: Math.max(0, Math.min(history.length - 1, index)), tab, step: 0 };
  const body = h('div', { class: 'review' });
  const stoppers = new Set();
  const stopAuto = () => { for (const stop of stoppers) stop(); };
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
    const tabs = segmented([['hands', 'Mains'], ['auction', 'Enchères'], ['tricks', 'Plis'], ['replay', 'Rejeu'], ['analysis', 'Analyse']], st.tab,
      (v) => { st.tab = v; drawTab(); }, { small: true });
    const content = h('div', { class: 'rv-content' });
    body.append(nav, tabs, content);
    const drawTab = () => {
      stopAuto();
      stoppers.clear();
      clear(content);
      if (st.tab === 'hands') content.append(handsTab(r));
      else if (st.tab === 'auction') content.append(auctionTab(r));
      else if (st.tab === 'tricks') content.append(tricksTab(r));
      else if (st.tab === 'analysis') content.append(analysisTab(r));
      else content.append(replayView(r, { state: st }));
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

  /**
   * Rejeu pas à pas d'une manche (réelle ou ligne gagnante).
   * state.step est conservé ; divergeStep = première carte qui diffère de la partie réelle.
   */
  function replayView(r, { state = { step: 0 }, divergeStep = null, realCards = null } = {}) {
    if (!r.tricks || !r.tricks.length) return noTricks();
    let timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    stoppers.add(stop);
    const wrap = h('div', { class: 'rv-replay' });
    const table = h('div', { class: 'rv-table' });
    const trickEl = h('div', { class: 'trick' });
    const seats = REL.map((pos) => h('div', { class: `rv-seat ${pos}` }));
    table.append(trickEl, ...seats);
    const counter = h('div', { class: 'rv-counter' });
    const score = h('div', { class: 'rv-score small' });
    const handsEl = h('div', { class: 'rv-hands' });
    const autoBtn = h('button', { class: 'btn small', 'aria-label': 'Lecture automatique' }, '⏯');
    const go = (k) => { state.step = Math.max(0, Math.min(32, k)); render(); };
    const controls = h('div', { class: 'rv-controls' },
      h('button', { class: 'btn small', 'aria-label': 'Début', onClick: () => { stop(); go(0); } }, '⏮'),
      h('button', { class: 'btn small', 'aria-label': 'Carte précédente', onClick: () => { stop(); go(state.step - 1); } }, '◀'),
      autoBtn,
      h('button', { class: 'btn small', 'aria-label': 'Carte suivante', onClick: () => { stop(); go(state.step + 1); } }, '▶'),
      h('button', {
        class: 'btn small', 'aria-label': 'Pli suivant',
        onClick: () => { stop(); go(state.step % 4 === 0 ? state.step + 4 : Math.ceil(state.step / 4) * 4); },
      }, '⏭'));
    autoBtn.addEventListener('click', () => {
      if (timer) { stop(); render(); return; }
      if (state.step >= 32) state.step = 0;
      timer = setInterval(() => {
        if (state.step >= 32) { stop(); render(); return; }
        go(state.step + 1);
      }, AUTO_DELAY);
      render();
    });
    wrap.append(table, counter, controls, score, handsEl);

    function render() {
      const rs = replayState(r, state.step);
      autoBtn.textContent = timer ? '⏸' : '⏯';
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
      if (divergeStep !== null) {
        counter.append(h('div', { class: `rv-phase ${state.step > divergeStep ? 'win' : ''}` },
          state.step > divergeStep ? '✓ Partie gagnante (cartes sur table)' : 'Partie réelle'));
      }
      if (state.step === 0) counter.append('Début de la manche : ', h('b', null, names[(r.dealer + 1) % 4]), ' entame.');
      else {
        counter.append(`Pli ${rs.trickIndex + 1}/8 · carte ${rs.trick.length}/4`);
        if (rs.complete) counter.append(h('span', { class: 'rv-won' }, ` — ${names[rs.winner]} remporte ${rs.trickPoints} pts`));
      }
      if (divergeStep !== null && state.step === divergeStep + 1 && realCards) {
        counter.append(h('div', { class: 'rv-fix' }, '← ', h('b', null, renderBidText(cardLabel(rs.last.card))),
          ' au lieu de ', renderBidText(cardLabel(realCards[divergeStep])), ' : c\'est ici que la manche a basculé.'));
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

  /** Score maximal cartes sur table pour chaque atout possible (min-max alpha-bêta, dans le Worker). */
  function scoresSection(r) {
    const sec = h('div', { class: 'rv-scores' });
    const leader = (r.dealer + 1) % 4;
    sec.append(h('h3', null, 'Score maximal par atout'),
      h('p', { class: 'muted small' },
        `Points de cartes (10 de der compris) que chaque équipe peut s'assurer cartes sur table si cet atout avait été choisi, avec la même entame (${names[leader]}). `,
        'Le meilleur contrat tient compte de la règle des 82 points et de la belote.'));
    const tbody = h('tbody');
    sec.append(h('table', { class: 'tbl rv-scores-tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Atout'), h('th', { class: 'us' }, 'Nous'), h('th', { class: 'them' }, 'Eux'), h('th', null, 'Meilleur contrat'))),
      tbody));
    let byRecord = scoresCache.get(r);
    if (!byRecord) { byRecord = new Map(); scoresCache.set(r, byRecord); }
    // l'atout joué d'abord, puis les autres
    const order = [r.contract.trump, ...SCORE_TRUMPS.filter((t) => t !== r.contract.trump)];
    const rows = {};
    for (const t of SCORE_TRUMPS) {
      const played = t === r.contract.trump;
      rows[t] = h('tr', { class: played ? 'played' : '' },
        h('td', null, h('span', { class: 'rv-trump' }, renderBidText(SUIT_SYMBOL[t])), ' ', h('span', { class: 'small muted' }, SUIT_NAME[t]),
          played ? h('div', { class: 'small rv-played' }, `joué : ${bidLabel(r.contract.value, t)}`) : null),
        h('td', null, '…'), h('td', null, '…'), h('td', { class: 'small muted' }, 'calcul…'));
      tbody.append(rows[t]);
    }
    const fill = (t, b) => {
      const tr = rows[t];
      if (!tr.isConnected && !sec.isConnected) return;
      const cells = tr.children;
      const bel = (team) => (b.beloteTeam === team ? h('span', { class: 'small muted' }, ' +20 B') : null);
      clear(cells[1]); clear(cells[2]); clear(cells[3]);
      if (b.us === null) {
        const rg = b.range;
        cells[1].append(rg ? `${rg[0]}–${rg[1]}` : '?');
        cells[2].append(rg ? `${162 - rg[1]}–${162 - rg[0]}` : '?');
        cells[3].append('calcul trop long');
        return;
      }
      append(cells[1], [h('b', null, b.us), bel(us)]);
      append(cells[2], [h('b', null, b.them), bel(1 - us)]);
      cells[3].className = '';
      if (b.bestUs) cells[3].append(h('span', { class: 'us' }, 'Nous : '), renderBidText(bidLabel(b.bestUs, t)));
      else if (b.bestThem) cells[3].append(h('span', { class: 'them' }, 'Eux : '), renderBidText(bidLabel(b.bestThem, t)));
      else cells[3].append(h('span', { class: 'muted' }, 'aucun'));
    };
    (async () => {
      for (const t of order) {
        let p = byRecord.get(`${mySeat}:${t}`);
        if (!p) { p = bestScoresAsync(r, mySeat, t); byRecord.set(`${mySeat}:${t}`, p); }
        try { fill(t, await p); } catch (e) { console.error(e); }
      }
    })();
    return sec;
  }

  /** La manche était-elle gagnable ? (min-max cartes sur table, dans le Worker) */
  function analysisTab(r) {
    const wrap = h('div', { class: 'rv-analysis' });
    const usTakers = r.contract.team === us;
    const goal = usTakers ? 'réussir votre contrat' : 'faire chuter le contrat adverse';
    wrap.append(h('p', { class: 'muted small' },
      'Analyse « cartes sur table » : chaque joueur voit les quatre mains et joue parfaitement. ',
      'Elle dit si la manche pouvait être gagnée en théorie ; en partie réelle, on ne voit pas le jeu des adversaires.'));
    if (!r.tricks || r.tricks.length < 8) { wrap.append(noTricks()); return wrap; }
    const box = h('div', { class: 'rv-result pending' }, h('div', { class: 'spinner small' }), 'Analyse de toutes les façons de jouer la donne…');
    wrap.append(box);
    const replayHolder = h('div');
    wrap.append(replayHolder, scoresSection(r));
    let byRecord = analysisCache.get(r);
    if (!byRecord) { byRecord = new Map(); analysisCache.set(r, byRecord); }
    let promise = byRecord.get(mySeat);
    if (!promise) { promise = analyzeRoundAsync(r, mySeat); byRecord.set(mySeat, promise); }
    promise.then((a) => {
      if (!wrap.isConnected) return;
      clear(box);
      if (a.undetermined) {
        box.className = 'rv-result';
        box.append(h('b', null, 'Analyse trop longue'), ' : impossible de conclure pour cette donne.');
        return;
      }
      if (!a.winnable) {
        box.className = 'rv-result no';
        box.append(h('div', { class: 'rv-verdict' }, 'Non'),
          `Même en jouant parfaitement, cartes sur table, votre équipe ne pouvait pas ${goal} : la manche était perdue dès la donne.`);
        if (!a.lost) box.append(h('div', { class: 'small' }, 'Vous l\'avez pourtant gagnée : les adversaires n\'ont pas trouvé le jeu parfait.'));
      } else if (!a.lost) {
        box.className = 'rv-result yes';
        box.append(h('div', { class: 'rv-verdict' }, 'Oui'), `Cartes sur table, votre équipe pouvait ${goal}, et elle l'a fait.`);
      } else {
        box.className = 'rv-result yes';
        const m = a.mistake;
        box.append(h('div', { class: 'rv-verdict' }, 'Oui !'),
          `Cartes sur table, votre équipe pouvait ${goal}.`,
          m ? h('div', { class: 'rv-mistake' },
            `La manche a basculé au pli ${m.trick} : ${m.seat === mySeat ? 'vous avez' : `${names[m.seat]} (${role(m.seat)}) a`} joué `,
            h('b', null, renderBidText(cardLabel(m.card))), ' ; il fallait jouer ',
            h('b', null, renderBidText(m.alternatives.map(cardLabel).join(' ou '))), '.') : null);
        if (a.line) {
          replayHolder.append(h('h3', null, 'Rejeu de la partie gagnante'),
            h('p', { class: 'muted small' }, 'Les cartes sont celles de la partie réelle jusqu\'au coup décisif, puis votre équipe joue le jeu gagnant ; les adversaires jouent comme les robots.'));
          const real = r.tricks.flatMap((t) => t.cards.map((x) => x.card));
          replayHolder.append(replayView(a.line, { state: { step: m ? m.step : 0 }, divergeStep: m ? m.step : null, realCards: real }));
        }
      }
      box.append(h('div', { class: 'muted small rv-stats' }, `${a.nodes.toLocaleString('fr-FR')} positions examinées en ${a.ms} ms`));
    }).catch((e) => {
      if (!wrap.isConnected) return;
      clear(box);
      box.className = 'rv-result';
      box.append(`L'analyse a échoué : ${e.message}`);
    });
    return wrap;
  }

  draw();
  return panel;
}
