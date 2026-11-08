// Écran des statistiques : partie en cours (toutes les manches) et historique de toutes les parties.
import { h, clear, segmented, confirmDialog, toast } from './dom.js';
import { teamOf, SUIT_NAME } from '../cards.js';
import { contractLabel } from '../auction.js';
import { computeGameStats, loadHistory, lifetimeStats, clearHistory, pct } from '../stats.js';
import { renderBidText, roundSummaryContent } from './game.js';
import { lineChart } from './chart.js';
import { openReview } from './review.js';

/**
 * @param {object|null} live  {history, names, seat, target} de la partie affichée (peut être null)
 */
export function statsBody(live) {
  const body = h('div', { class: 'stats' });
  const content = h('div');
  let tab = live && live.history.length ? 'game' : 'all';
  const tabs = segmented([['game', 'Cette partie'], ['all', 'Toutes les parties']], tab, (v) => { tab = v; draw(); });
  body.append(tabs, content);
  const draw = () => {
    clear(content);
    content.append(tab === 'game' ? gameStats(live) : allStats());
  };
  draw();
  return body;
}

function gameStats(live) {
  if (!live || !live.history.length) return h('p', { class: 'muted' }, 'Aucune manche terminée pour l\'instant.');
  const { history, names, seat, target } = live;
  const us = teamOf(seat);
  const them = 1 - us;
  const st = computeGameStats(history);
  const wrap = h('div');

  // Évolution des scores
  wrap.append(h('h3', null, 'Évolution des scores'));
  const chartBox = h('div', { class: 'chart-box' });
  wrap.append(chartBox);
  requestAnimationFrame(() => lineChart(chartBox, {
    series: [
      { name: 'Nous', cls: 'us', values: [0, ...st.series.map((t) => t[us])] },
      { name: 'Eux', cls: 'them', values: [0, ...st.series.map((t) => t[them])] },
    ],
    target,
    xLabel: (i) => (i === 0 ? 'Début' : `Manche ${i}`),
  }));

  // Équipes
  const T = st.teams;
  const row = (label, a, b) => h('tr', null, h('td', null, label), h('td', null, a), h('td', null, b));
  wrap.append(h('h3', null, `Équipes · ${st.rounds} manche${st.rounds > 1 ? 's' : ''}`),
    h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th'), h('th', { class: 'us' }, 'Nous'), h('th', { class: 'them' }, 'Eux'))),
      h('tbody', null,
        row('Contrats pris', T[us].taken, T[them].taken),
        row('Réussis', `${T[us].success} (${pct(T[us].successRate)})`, `${T[them].success} (${pct(T[them].successRate)})`),
        row('Chutés', T[us].failed, T[them].failed),
        row('Coinches (gagnées)', `${T[us].coinched} (${T[us].coincheWon})`, `${T[them].coinched} (${T[them].coincheWon})`),
        row('Belotes', T[us].belotes, T[them].belotes),
        row('Capots', T[us].capots, T[them].capots),
        row('Plis gagnés', T[us].tricks, T[them].tricks),
        row('Points de cartes / manche', T[us].avgCardPoints, T[them].avgCardPoints),
        row('Meilleure manche', T[us].bestRound, T[them].bestRound),
        row('Points marqués', T[us].scored, T[them].scored))));

  // Joueurs
  const order = [seat, (seat + 2) % 4, (seat + 1) % 4, (seat + 3) % 4];
  wrap.append(h('h3', null, 'Joueurs'),
    h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Joueur'), h('th', null, 'Prises'), h('th', null, 'Réussite'), h('th', null, 'Plis'), h('th', null, 'Coinches'))),
      h('tbody', null, order.map((s) => {
        const p = st.players[s];
        return h('tr', null,
          h('td', { class: teamOf(s) === us ? 'us' : 'them' }, names[s]),
          h('td', null, p.taken), h('td', null, pct(p.successRate)), h('td', null, p.tricks), h('td', null, p.coinches));
      }))));

  // Atouts
  const trumps = Object.entries(st.byTrump);
  if (trumps.length) {
    wrap.append(h('h3', null, 'Contrats par atout'),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Atout'), h('th', null, 'Joués'), h('th', null, 'Réussite'))),
        h('tbody', null, trumps.map(([t, x]) => h('tr', null,
          h('td', null, SUIT_NAME[t]), h('td', null, x.taken), h('td', null, pct(x.success / x.taken)))))));
  }

  // Détail des manches
  wrap.append(h('h3', null, 'Détail des manches'));
  const list = h('div', { class: 'rounds' });
  for (const r of [...history].reverse()) {
    const ours = r.contract.team === us;
    const good = ours ? r.success : !r.success;
    const det = h('details', { class: `round-item ${good ? 'good' : 'bad'}` },
      h('summary', null,
        h('span', { class: 'ri-n' }, `#${r.round}`),
        h('span', { class: 'ri-c' }, renderBidText(`${names[r.contract.seat]} · ${contractLabel(r.contract)}`)),
        h('span', { class: 'ri-s' }, `${r.score[us]} / ${r.score[them]}`),
        h('span', { class: 'ri-r' }, r.success ? '✓' : '✗')),
      h('div', { class: 'ri-body' }, roundSummaryContent(r, seat, names, {
        onReview: () => openReview(history, r.round - 1, { names, mySeat: seat }),
      }).slice(1)));
    list.append(det);
  }
  wrap.append(list);
  return wrap;
}

function allStats() {
  const games = loadHistory();
  const s = lifetimeStats(games);
  const wrap = h('div');
  if (!games.length) {
    wrap.append(h('p', { class: 'muted' }, 'Aucune partie terminée n\'a encore été enregistrée sur cet appareil.'));
    return wrap;
  }
  const tile = (label, value, sub) => h('div', { class: 'tile' },
    h('div', { class: 'tile-v' }, value), h('div', { class: 'tile-l' }, label), sub ? h('div', { class: 'tile-s' }, sub) : null);
  wrap.append(h('div', { class: 'tiles' },
    tile('Parties gagnées', `${s.wins} / ${s.games}`, pct(s.games ? s.wins / s.games : null)),
    tile('Manches', s.rounds, `${pct(s.rounds ? s.roundsWon / s.rounds : null)} gagnées`),
    tile('Mes contrats', s.myContracts, `${pct(s.myContracts ? s.mySuccess / s.myContracts : null)} réussis`),
    tile('Contrats de l\'équipe', s.teamContracts, `${pct(s.teamContracts ? s.teamSuccess / s.teamContracts : null)} réussis`),
    tile('Coinches', s.coinches, `${s.coinchesWon} gagnées`),
    tile('Points / manche', s.avgPoints, `${s.belotes} belotes · ${s.capots} capots`)));

  wrap.append(h('h3', null, 'Dernières parties'));
  const list = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Manches'), h('th', null, 'Score'), h('th', null, ''))),
    h('tbody', null, [...games].reverse().slice(0, 30).map((g) => {
      const us = teamOf(g.mySeat);
      const won = g.winner === us;
      const d = new Date(g.date);
      return h('tr', null,
        h('td', null, `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${g.online ? ' 🌐' : ''}`),
        h('td', null, g.rounds.length),
        h('td', null, `${g.scores[us]} – ${g.scores[1 - us]}`),
        h('td', { class: won ? 'ok' : 'ko' }, won ? 'Gagnée' : 'Perdue'));
    })));
  wrap.append(list,
    h('button', {
      class: 'btn small ghost',
      onClick: async () => {
        if (await confirmDialog('Effacer tout l\'historique des parties ?', { ok: 'Effacer' })) {
          clearHistory();
          toast('Historique effacé');
          clear(wrap);
          wrap.append(h('p', { class: 'muted' }, 'Historique effacé.'));
        }
      },
    }, 'Effacer l\'historique'));
  return wrap;
}
