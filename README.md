# Idle Progress Bar MMO — Auto Buy

Userscript Tampermonkey pour [Idle Progress Bar MMO](https://idle-progress-bar-mmo.vercel.app/).
Il surligne l'upgrade et la recherche les plus rentables directement dans le jeu, les achète
automatiquement, et ramasse les boîtes dès qu'elles apparaissent.

> **C'est un script d'automatisation.** Il joue à ta place. À n'utiliser qu'avec l'accord
> du développeur du jeu.

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/)
2. Tableau de bord → **Créer un nouveau script**
3. Tout sélectionner (Ctrl+A), coller le contenu de [`idle-autobuy.user.js`](idle-autobuy.user.js), enregistrer (Ctrl+S)
4. Ouvrir le jeu — un panneau apparaît en bas à droite

Le script ne contient aucune donnée liée à un compte précis : le classement des achats se
recalcule entièrement depuis l'état reçu du jeu, il s'adapte donc tout seul à n'importe quel
compte et n'importe quel stade de partie.

## Le panneau

```
● AUTO BUY                    – [ON]
470 916 ⚡ · +5 718/s · 74 achats
⏳ reset dans 4h09 · 🎉 ×2 8m12 · base 2 859/s
→ Generator MK3 · ⚡56,05M · 2h59
≈ 182M produits d'ici le reset · ⏸ épargne
🔬 Production boost · 3 764 (2 057 dispo)
📦 boîtes : AUTO · 43 ramassées
🔌 état reçu il y a 2s · 0 req. ajoutées
⚡ Generator MK1 ×4 → niv.91
📦 +4 136 393 ⚡ · +73 🔬
```

- **ON/OFF** ne pilote que les achats. L'analyse et le surlignage tournent en permanence,
  ce qui permet de s'en servir comme simple assistant visuel en jouant à la main.
- **📦 boîtes** se bascule indépendamment (clic sur la ligne).
- Les deux réglages sont mémorisés dans `localStorage`.
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

`Cost Reduction` ne produit rien directement : sa valeur est mesurée par simulation —
dérouler la journée avec et sans cet achat, et comparer l'énergie totale produite.

## Comment il choisit — Recherches

Même principe : un critère unique, **⚡ gagnés par jour et par point investi**, recalculé
en direct à chaque état reçu. Le classement se réorganise tout seul à mesure que les coûts
montent (+15 %/niveau), sans ordre codé en dur.

- `income`, `synergy` : +1 %/niveau de production, permanent.
- `base` : +1 ⚡/s de base, agit à la fois sur le cycle actif et sur le plancher de
  production qui survit au reset (donc sur ce que rapporte le hors ligne).
- `offline` : +1 point de ratio hors ligne, valorisé sur le plancher post-reset.
- `quickStart` : garantit un palier de départ sur les générateurs à chaque reset
  (proportionnel au meilleur niveau jamais atteint, arrondi **au supérieur**) ; valorisée
  par simulation de branches, comme Cost Reduction, parce que son effet déplace le point de
  départ de toute la journée plutôt que d'ajouter un simple pourcentage.

### Calibration du hors ligne

Le modèle hors ligne est calé sur une mesure réelle plutôt que sur des valeurs supposées :
12 h de coupure ont rapporté 6,17 M ⚡. Une première calibration naïve (plancher complet
`mult(p)` × 12 h) tombait 38 % au-dessus de la mesure. Le développeur du jeu a confirmé que
les boosts **globaux** (Collective Synergy, qui agrège le niveau de recherche de tous les
joueurs connectés) ne s'appliquent pas hors ligne — seuls les bonus **personnels et
permanents** comptent. En excluant Collective Synergy et en ne gardant que la recherche
`income` (+1 %/niveau, personnelle), le modèle tombe pile sur la mesure : écart 0,000 %.
`OFFLINE_BASE_RATIO` reprend donc directement la valeur de l'infobulle du jeu (0,50).

La même mesure a aussi corrigé deux erreurs indépendantes : le palier Quick Start s'arrondit
au supérieur (à 20 % de 95/59/51 le jeu accorde 19/12/11, ce que seul `ceil` reproduit), et
`baseRate()` doit inclure le bonus de la recherche `base` — sans quoi `mult()`, défini comme
`permRate / baseRate`, l'absorbe et le compte une seconde fois.

`offlineResearch` et `dailyBonus` rapportent des **points**, pas de l'énergie — elles se
comparent dans leur propre monnaie (points gagnés par jour et par point investi) plutôt que
d'être converties arbitrairement, et servent de repli quand rien d'autre n'est abordable
pour ne pas laisser de points dormir.

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
| `AUTO_RESEARCH` | `true` | acheter aussi les recherches |
| `WAIT_WEIGHT` | 24 | poids de l'attente dans le score des upgrades |
| `OFFLINE_DAYS_PER_WEEK` | 2.5 | rythme de déconnexion estimé, influence le classement d'`offline` |
| `OFFLINE_CAP_HOURS` | 12 | plafond de durée créditée hors ligne (confirmé par le jeu) |
| `OFFLINE_BASE_RATIO` | 0.50 | socle de la part créditée hors ligne, hors bonus de recherche (infobulle du jeu, confirmé exact) |
| `WATCHDOG_MS` | 60000 | délai avant d'aller chercher l'état soi-même |

## Limites connues

- La simulation d'upgrades reste une politique gloutonne recalculée à chaque état, pas une
  optimisation globale sur toute la journée.
- La récompense des boîtes est supposée constante alors qu'elle est indexée sur la
  puissance du joueur.
- Synergie collective et bonus externes sont capturés via un facteur calibré sur l'état
  courant, pas suivis en continu.
- Le surlignage retrouve les cartes par leur **titre**. Si le jeu renomme une upgrade ou
  une recherche, le surlignage disparaît silencieusement — il suffit de mettre à jour les
  objets `LABELS`/`LABELS_RESEARCH`. Les achats, eux, passent par les identifiants d'API.
- Chrome bride les timers des onglets en arrière-plan. Pour une session longue, garder la
  fenêtre visible et exclure le site de l'économiseur de mémoire
  (`chrome://settings/performance`).

## Licence

MIT — voir [LICENSE](LICENSE).
