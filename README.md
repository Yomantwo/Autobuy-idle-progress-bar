# Idle Progress Bar MMO — Helper

Userscript Tampermonkey pour [Idle Progress Bar MMO](https://ipb-mmo.ereldev.com/).
Il surligne l'upgrade et la recherche les plus rentables directement dans le jeu. L'achat
automatique (upgrades, recherches, Factory) et le ramassage des boîtes sont optionnels,
activables séparément.

> **C'est un script d'automatisation.** Il joue à ta place. À n'utiliser qu'avec l'accord
> du développeur du jeu.

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/)
2. Tableau de bord → **Créer un nouveau script**
3. Tout sélectionner (Ctrl+A), coller le contenu de [`idle-progress-bar-mmo-helper.user.js`](idle-progress-bar-mmo-helper.user.js), enregistrer (Ctrl+S)
4. Ouvrir le jeu — un panneau apparaît en bas à droite

Le script ne contient aucune donnée liée à un compte précis : le classement des achats se
recalcule entièrement depuis l'état reçu du jeu, il s'adapte donc tout seul à n'importe quel
compte et n'importe quel stade de partie.

## Le panneau

```
● AUTO BUY                    – [TOUT]
470 916 ⚡ · +5 718/s · 74 achats
⏳ reset dans 4h09 · 🎉 ×2 8m12 · base 2 859/s
Auto-achat : ⚡ ON  🔬 ON  🏭 OFF
→ Generator MK3 · ⚡56,05M · 2h59
cible hors d'atteinte, achète Generator MK1
🔬 Production boost · 3 764 (2 057 dispo)
🏭 Warehouse · 2 032 (455 🔋) · ⏸ · plein dans 19m27
📦 boîtes : AUTO · 43 ramassées
🔌 état reçu il y a 2s · 0 req. ajoutées
⚡ Generator MK1 ×4 → niv.91
📦 +4 136 393 ⚡ · +73 🔬
```

- **⚡ 🔬 🏭** se basculent indépendamment (clic sur chaque icône) : achats upgrades,
  recherches et Factory activables séparément — utile pour garder une catégorie en
  manuel. **TOUT** est un raccourci qui active ou désactive les trois d'un coup.
  L'analyse et le surlignage tournent en permanence quoi qu'il arrive, ce qui permet
  de s'en servir comme simple assistant visuel même les trois catégories désactivées.
- Le surlignage suit l'onglet affiché : upgrade cible sur **UPGRADES**, recherche sur
  **RESEARCH**, bâtiment sur **FACTORY**. Vert = achetable, orange = on épargne.
- La ligne 🏭 n'apparaît qu'une fois `Factory Access` recherchée ; elle affiche le bâtiment
  visé, le stock disponible, et le temps avant que le `warehouse` soit plein. Si le stock
  suffit mais que rien n'est acheté, elle précise pourquoi (plein exigé, ou reset trop proche).
- **📦 boîtes** se bascule indépendamment (clic sur la ligne).
- Tous les réglages sont mémorisés dans `localStorage`.
- **–** replie le panneau.

## Comment il choisit — Upgrades

Un seul objectif : **maximiser l'énergie produite d'ici le reset de minuit UTC** (upgrades
et énergie repartent à zéro à ce moment-là, les recherches survivent).

Chaque upgrade éligible est classée par un score `WAIT_WEIGHT × attente + remboursement` :
- **attente** = temps pour l'économiser à la production garantie actuelle (hors bonus
  temporaires)
- **remboursement** = temps pour que l'achat se rentabilise via le ⚡/s qu'il apporte

Le score le plus bas gagne. Ce critère unifie deux régimes : quand tout est abordable
(attente nulle) il redevient un simple ratio gain/coût ; en début de journée, quand
l'énergie est rare, il évite de viser un objectif inaccessible pendant que d'autres achats
plus modestes attendent.

Ce score sert à trier, mais la décision finale revient à une **simulation directe** : chaque
candidat est déroulé jusqu'au reset, et celui qui produit réellement le plus d'énergie gagne.
Un score marginal ne voit pas que l'ordre d'achat compte — un multiplicateur acheté plus tard
profite d'une base plus grande, effet qu'une simulation capture et qu'une formule manque.

`Cost Reduction` ne produit rien directement : il est comparé de la même façon, en déroulant
la journée avec et sans cet achat.

## Comment il choisit — Recherches

Même principe : un critère unique, **⚡ gagnés par jour et par point investi**, recalculé
en direct à chaque état reçu. Le classement se réorganise tout seul à mesure que les coûts
montent (+15 %/niveau), sans ordre codé en dur.

- `income`, `synergy` : +1 %/niveau de production, permanent.
- `base` : +10 ⚡/s de base par niveau, agit à la fois sur le cycle actif et sur le plancher
  de production qui survit au reset (donc sur ce que rapporte le hors ligne).
- `offline` : +1 point de ratio hors ligne, valorisé sur le plancher post-reset.
- `quickStart` : garantit un palier de départ sur les générateurs à chaque reset
  (proportionnel au meilleur niveau jamais atteint, arrondi **au supérieur**) ; valorisée
  par simulation de branches, comme Cost Reduction, parce que son effet déplace le point de
  départ de toute la journée plutôt que d'ajouter un simple pourcentage.
- `tierResonance` : +1 %/tier atteint, plafonné à 5×niveau tiers comptés (formule lue dans
  le bundle du jeu). Rendements décroissants une fois le plafond au-delà du tier réel — le
  gain marginal retombe à 0 jusqu'à ce que `maxTierReached` progresse, sans exclusion codée
  en dur : le classement se corrige tout seul.

`autoBuy` n'est jamais achetée, volontairement : elle débloque un auto-achat natif du jeu
qui augmente le coût de tous les upgrades de 25 % tant qu'il est actif, sans rien apporter
que ce script ne fasse déjà — en mieux (rythme adaptatif au lieu d'un rachat fixe toutes les
60 s, sans le surcoût).

Le plancher hors ligne n'applique que les bonus **personnels et permanents** (recherche
`income`) : les boosts **globaux** (Collective Synergy, agrégée entre joueurs connectés) ne
s'appliquent pas hors ligne. Le palier Quick Start s'arrondit systématiquement **au
supérieur**, et le bonus de la recherche `base` est compté une seule fois dans le calcul du
plancher.

`offlineResearch` et `dailyBonus` rapportent des **points**, pas de l'énergie — elles se
comparent dans leur propre monnaie (points gagnés par jour et par point investi) plutôt que
d'être converties arbitrairement, et servent de repli quand la cible n'est pas abordable.
Ce repli est lui aussi soumis à un délai de remboursement (30 jours) : au-delà, le script
épargne, les points valant plus placés sur la cible énergie — et ils ne périment pas au reset.

## Comment il choisit — Factory

Une troisième monnaie : les **Power Cells**. `Reactor` en génère en continu (part de la
production), `Warehouse` plafonne le stock, `Refinery` convertit tout le stock en points de
recherche au reset — intégralement, sans reste : tout ce qui dépasse la capacité est perdu,
toute capacité inutilisée au moment du reset l'est aussi.

`reactor` ne rapporte aucun point de recherche directement, il finance les deux autres — mais
un score marginal classique le sous-évalue : agrandir `warehouse` augmente la récolte tout en
réduisant d'autant le budget quotidien disponible (production moins capacité à reconstituer),
si bien qu'un classement purement marginal finit par s'étrangler lui-même. Les trois bâtiments
sont donc répartis selon une allocation résolue analytiquement (maximiser la croissance du
budget à long terme), recalculée à chaque état reçu à partir des coûts et débits réels.

Le bâtiment le plus en retard sur sa part cible de dépense cumulée est acheté en priorité,
parmi ceux dont le coût reste sous la capacité maximale du `warehouse` (sinon jamais payable).

La réserve avant reset s'applique aux trois : si le temps pour regagner ce qui serait dépensé
dépasse ce qu'il reste avant le reset, le script épargne plutôt que de vider le stock juste
avant qu'il ne se convertisse.

## Coût réseau

Le script **n'émet aucune requête de lecture**. Il enveloppe `window.fetch` et lit au
passage les réponses `/api/state` que la page réclame déjà toutes les 3 secondes
(`res.clone()`, le corps reste intact pour React). Ses seules requêtes sont les achats
et les ramassages de boîtes — soit exactement ce qu'un joueur qui clique produirait.

Un watchdog va chercher l'état lui-même si plus rien n'est reçu pendant 60 s (page en
erreur, onglet gelé). C'est le seul cas où une lecture est émise.

Toutes les requêtes du script passent par une écluse qui les sérialise à **une toutes les
3,2 secondes minimum**, rafale post-reset comprise. C'est volontairement sous la limite
d'un appel toutes les 3 s annoncée par le développeur du jeu. La marge de 200 ms couvre
le déclenchement anticipé de `setTimeout` et la gigue réseau.

## Réglages

En haut du fichier :

| Constante | Défaut | Rôle |
|---|---|---|
| `MAX_ACTIONS` | 8 | actions max par salve |
| `MIN_REQ_GAP_MS` | 3200 | écart minimal entre deux requêtes du script |
| `BULK_MAX` | 25 | plafond dur sur la quantité par requête |
| `RESERVE` | 0 | énergie à toujours garder de côté |
| `WAIT_WEIGHT` | 24 | poids de l'attente dans le score des upgrades |
| `OFFLINE_DAYS_PER_WEEK` | 2.5 | rythme de déconnexion estimé, influence le classement d'`offline` |
| `OFFLINE_CAP_HOURS` | 12 | plafond de durée créditée hors ligne (confirmé par le jeu) |
| `OFFLINE_BASE_RATIO` | 0.50 | socle de la part créditée hors ligne, hors bonus de recherche |
| `OFFLINE_PTS_PER_HOUR` | 408 | points/heure hors ligne, mesuré sur un compte (ne suit pas la puissance du joueur) |
| `BASE_PER_LEVEL` | 10 | ⚡/s apporté par niveau de la recherche `base` |
| `DAILY_BONUS_PER_LEVEL` | 0.225 | points de pourcentage apportés par niveau de `dailyBonus` |
| `POINTS_PAYBACK_DAYS` | 30 | délai de remboursement max du repli `offlineResearch`/`dailyBonus` |
| `WATCHDOG_MS` | 60000 | délai avant d'aller chercher l'état soi-même |
| `ACT_BACKOFF_MS` | 60000 | pause après un achat refusé par le serveur |

## Limites connues

- La simulation d'upgrades reste une politique gloutonne recalculée à chaque état, pas une
  optimisation globale sur toute la journée.
- `OFFLINE_PTS_PER_HOUR` (valorisation d'`offlineResearch`) est une constante mesurée sur
  un compte, pas rescalée sur la puissance réelle du joueur — le ramassage de boîtes lui-même
  lit la vraie récompense en direct, sans approximation.
- Synergie collective et bonus externes sont capturés via un facteur calibré sur l'état
  courant, pas suivis en continu.
- Le surlignage retrouve les cartes par leur **titre**. Si le jeu renomme une upgrade ou
  une recherche, le surlignage disparaît silencieusement — il suffit de mettre à jour les
  objets `LABELS`/`LABELS_RESEARCH`. Les achats, eux, passent par les identifiants d'API.
- Chrome bride les timers des onglets en arrière-plan. Pour une session longue, garder la
  fenêtre visible et exclure le site de l'économiseur de mémoire
  (`chrome://settings/performance`).

## Versions

`MAJEUR.MINEUR.PATCH` : majeur pour un nouveau système entier (upgrades → +recherches →
+Factory), mineur pour une nouveauté réelle dans un système existant (nouvelle recherche,
nouvelle règle de décision), patch pour les corrections et recalibrations sans changement
de comportement.

## Licence

MIT — voir [LICENSE](LICENSE).
