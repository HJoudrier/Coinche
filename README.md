# Coinche

Jeu de **coinche sans annonces** en HTML, CSS et JavaScript, sans build ni serveur à maintenir.
On joue contre des robots ou en ligne avec des amis, qui rejoignent la table en scannant un **QR code**.
L'interface est pensée d'abord pour le téléphone.

## Fonctionnalités

- **Enchères** de 80 à 180, Capot et Générale, à ♥ ♦ ♣ ♠, Sans atout ou Tout atout. Coinche (×2) et surcoinche (×4).
- **Règle des 82 points** : les preneurs doivent toujours faire au moins 82 points de cartes, belote non comptée.
  Une enchère à 80 n'est donc jamais remplie grâce à la belote. Au-delà, la belote des preneurs compte pour atteindre le contrat.
- **Décompte « contrat + points faits »** : réussi = contrat + points faits ; chuté = 160 + contrat pour la défense ;
  coinché/surcoinché = 160 + contrat × multiplicateur pour l'équipe gagnante. La belote (20) reste toujours à l'équipe qui la détient.
- **Robots** à trois niveaux : facile, moyen (heuristiques et mémoire des cartes) et difficile (Monte-Carlo).
  Le niveau difficile tire jusqu'à 500 donnes possibles par carte (réglable). Les donnes sont tirées selon les déductions : annonces, appels, cartes jouées, singletons probables, obligation de monter.
  Chaque donne est jouée jusqu'au bout avec l'algorithme des robots. Les cartes nettement moins bonnes sont écartées en cours de route.
  Le calcul tourne dans un Web Worker : l'écran reste fluide.
- **Enchères par conventions** : la première annonce montre l'atout. 80 se fait avec le valet ou le 9 et 4 atouts, 90 avec le valet et le 9. Le barrage se fait avec 6 atouts.
  Le partenaire soutient à +10 par carte utile (as, valet ou 9 d'atout ; belote +20), et l'ouvreur annonce ses as au second tour.
  En sans atout et en tout atout, on compte ses levées sûres : 5 = 80, 6 = 90, 7 = 110. Celui qui entame la manche compte en entier sa longue couleur maîtresse.
- **Jeu de la carte des robots** :
  - L'équipe preneuse fait tomber les atouts adverses avant de jouer ses as, et le partenaire du preneur rejoue atout.
    Si le partenaire tient le valet, on entame petit atout pour forcer l'adversaire à monter (son 9 peut tomber).
  - Les robots retiennent ce que le jeu révèle : couleur non fournie, 10 sec ou 9 sec, atout plus faible joué alors qu'il fallait monter.
  - Ils pratiquent les **appels** à la première défausse : petite carte de la couleur de son as.
    L'équipe preneuse passe aux **contre-appels** (« rien ici ») à partir d'un contrat réglable, 100 par défaut ; la défense appelle toujours directement.
- **Lecture des annonces** : chaque enchère révèle des cartes, par exemple 90 ♥ = valet et 9 de ♥. Les robots croisent ces informations avec leur main.
  Ils passent à tout atout quand l'équipe tient les 4 valets, exigent des arrêts dans la couleur adverse pour le sans atout et le tout atout, et coinchent un tout atout avec 2 valets.
  Au jeu de la carte, le robot difficile ne simule que des donnes compatibles avec les annonces. L'aide affiche « ce que l'on sait des mains ».
  À partir de l'aide « Intermédiaire », toucher une bulle d'annonce en donne la signification.
- **Partie en ligne** : chaque place peut être tenue par un robot ou réservée à un invité. L'invité scanne le QR code ou saisit le code de la partie.
  Il peut se reconnecter à sa place, et un robot joue pour lui pendant une déconnexion.
- **Aides réglables**, de « aucune » à « expert », séparément pour les enchères et pour le jeu :
  force de la main, enchère conseillée, lecture des annonces, cartes jouables, carte conseillée, atouts restants, cartes maîtresses.
- **Temps limité** réglable pour chaque enchère et pour chaque carte. À expiration, le joueur passe, ou bien la carte conseillée est jouée.
- **Score global** mis à jour à chaque manche, avec un résumé de fin de manche : points, belote, plis.
- **Revoir la donne** depuis le résumé de fin de manche ou les statistiques, pour chaque manche de la partie.
  On y trouve les mains de départ, les enchères avec leur signification, les 8 plis (qui entame, qui remporte, cumul des points) et un rejeu pas à pas sur la table, en manuel ou en lecture automatique.
- **Statistiques** de la partie sur toutes les manches (courbe des scores, équipes, joueurs, atouts) et historique de toutes les parties jouées sur l'appareil.
- **Page de paramétrage** : nom, niveau des robots, score à atteindre, vitesse des robots, aides, timers.
- La partie solo est sauvegardée automatiquement et peut être reprise depuis l'accueil.

## Jouer

### En local

Les modules JavaScript ne se chargent pas depuis `file://`. Il faut lancer un petit serveur web :

```bash
python3 -m http.server 8080
```

Ouvrez ensuite <http://localhost:8080>.

### En ligne (GitHub Pages)

Pour inviter des joueurs, le jeu doit être servi depuis une adresse publique en HTTPS, puisque c'est l'adresse encodée dans le QR code.
Avec GitHub Pages :

1. Dans le dépôt, allez dans **Settings → Pages**.
2. Choisissez **Deploy from a branch**, puis la branche et le dossier racine (`/`).
3. Le jeu est publié à l'adresse `https://<utilisateur>.github.io/<dépôt>/`.

Pour lancer une partie en ligne :

1. L'hôte ouvre **Nouvelle partie** et passe une ou plusieurs places en **Invité** : un QR code et un code de partie s'affichent.
2. Les invités scannent le QR code avec leur téléphone, ou ouvrent **Rejoindre une partie** et saisissent le code.
3. L'hôte appuie sur **Lancer la partie**. Les places invitées restées libres sont tenues par des robots.

La connexion est en pair-à-pair (WebRTC, via [PeerJS](https://peerjs.com)). Le navigateur de l'hôte fait tourner la partie.
La mise en relation passe par le serveur public gratuit de PeerJS, et aucune donnée de jeu n'y est stockée.
Sans serveur TURN, certains réseaux très restrictifs (réseaux d'entreprise, certains réseaux mobiles) peuvent bloquer la connexion.
Dans ce cas, essayez en Wi-Fi. Un serveur PeerJS personnel peut être indiqué dans **Paramètres → Avancé**.

## Tests

```bash
npm test
```

Les tests couvrent les règles (fournir, monter, couper, surcouper, sous-couper, sans atout, tout atout), les enchères, le décompte
(règle des 82, belote, capot, générale, coinche) et des parties complètes simulées entre robots.

## Structure

```
index.html            page unique
css/style.css         styles (mobile d'abord)
js/cards.js           cartes, valeurs, ordres, mélange
js/rules.js           cartes jouables, gagnant du pli, belote
js/auction.js         enchères, coinche, surcoinche
js/scoring.js         réussite du contrat et décompte
js/engine.js          moteur de partie (état sérialisable, vues par joueur)
js/ai.js              robots (heuristiques + Monte-Carlo) et évaluation des mains
js/advisor.js         aides aux enchères et au jeu
js/host.js            hôte de partie : robots, timers, diffusion des vues
js/network.js         jeu en ligne (PeerJS)
js/stats.js           statistiques et historique
js/settings.js        paramètres
js/ui/                interface (table de jeu, statistiques, paramètres)
vendor/               PeerJS 1.5.5 et qrcode-generator 2.0.4 (licence MIT)
tests/                tests unitaires et simulations (node:test)
```

## Licence

GPL-3.0 (voir `LICENSE`). Les bibliothèques du dossier `vendor/` sont sous licence MIT.
