# Changelog

## 3.10.0
- Fix majeur : les prix envoyes par le serveur portent DEJA la remise de Cost Reduction. Les simulations de journee fraiche (quickStart, Tier 2) repartaient de ces prix remises puis reappliquaient la remise au fil du jour — elles tournaient avec des prix 40% trop bas. Verifie a 0,00% en extrapolant deux instantanes separes de 14 niveaux avec costReduction a 22 puis 20
- Fix majeur : costOptimizer etait note -11,6 M energie/jour. En sequence forcee son j-ieme achat se faisait un niveau plus haut que la branche de reference, donc 35% plus cher, alors qu'en jeu le palier offert DISPENSE du premier achat au lieu de le rencherir. Les branches sont desormais alignees sur le niveau atteint, pas sur la position dans la sequence : le score passe a +5,5 k/jour, positif
- Valorisation des paliers de depart (quickStart, incomeOptimizer, costOptimizer) : les deux branches comparees rejouent la MEME sequence d'achats, ce qui supprime le bruit d'ordonnancement du glouton (~10 M energie/jour, du meme ordre que le signal cherche)
- Nouvelle regle : le rendement d'un palier de depart est CONVEXE (+10 niveaux de costOptimizer valent 97x ce que vaut +1). Noter le seul niveau suivant condamnait la montee des le premier pas — le classement retient desormais le meilleur BLOC de niveaux (1, 2, 4, 8, 16), l'achat restant niveau par niveau
- Consequence : costOptimizer passe de -11,6 M (artefact) a un score de 2,43 sur son meilleur bloc de 8 niveaux, incomeOptimizer a 0,33. Les deux restent tres loin de tierResonance (6 196), base (1 402) et income (1 003) : le script continue de ne pas les acheter, mais sur un modele correct et non sur un artefact
- Classement complet des recherches mesure a 11 ms, aucun impact sur la charge

## 3.9.0
- Ajout : bascules independantes pour upgrades, recherches et Factory (au lieu d'un seul ON/OFF global) — permet ex. de garder la Factory en manuel tout en laissant tourner les upgrades
- Le bouton TOUT reste un raccourci pour activer/desactiver les trois d'un coup

## 3.8.1
- UI : la ligne Factory precise a nouveau pourquoi aucun achat n'est en cours (attend le plein du warehouse, ou reset trop proche) au lieu d'un simple pause generique

## 3.8.0
- Factory : le score marginal figeait les achats (reactor jamais achete, puis la capacite reservee devorait tout le budget et la progression s arretait). Remplace par une repartition du budget resolue analytiquement : le reactor cree le budget, le warehouse le consomme
- Consequence mesuree au depart reel des deux comptes : +24% de RP cumules sur 7 jours, la progression ne se bloque plus

## 3.7.0
- Securite : injection HTML possible via les champs renvoyes par le serveur (ex. un niveau piege) qui finissaient bruts dans le panneau — tout ce qui vient du serveur est desormais echappe
- Refonte du jeu du 18/09 : toutes les formules Factory recalibrees (cout unifie 500+4235/niv, capacite 5000+4750/niv, conversion 0,02+0,004/niv, part reactor lineaire sans plafond)
- Reactor : recherche de palier sur 30 j supprimee, remplacee par un classement glouton incluant une paire reactor+warehouse — les deux se bridant via le min(), les evaluer isolement figeait le script
- Fix : recherche base valorisee a +1 energie/s alors qu'un niveau en donne +10 — sous-evaluee d'un facteur 10 depuis toujours, elle passe desormais premiere au classement
- Fix : dailyBonus valorise a +0,1/niveau au lieu de +0,225
- Achat warehouse tente seulement stock plein (le jeu l'exige, cout affiche errone cote serveur)
- Pause d'une minute apres un achat refuse, au lieu de retenter toutes les 3 s

## 3.6.1
- Ajout : temps avant que le warehouse soit plein, affiche sur la ligne Factory — reste visible (« Attente du remplissage ») meme sans achat prevu
- Simplification : retire la projection « XXM produits d'ici le reset » et l'etat « epargne », tous deux sans valeur actionnable — garde uniquement le repli sur un achat de secours

## 3.6.0
- Fix : gain d'income/synergy surestime — le jeu applique (1+0,01xniveau), le marginal est 0,01/(1+0,01L) et non 1% du total (-33% a niveau 50, -67% a niveau 200)
- Garde-fou : repli POINTS (dailyBonus/offlineResearch) refuse au-dela de 30 jours de remboursement — il gaspillait des PR qui valent plus places sur la cible energie

## 3.5.1
- Fix : le score marginal des upgrades ignorait l'ordre d'achat (un multiplicateur profite plus tard d'une base plus grande) — decision desormais par simulation directe de chaque candidat, comme Cost Reduction

## 3.5.0
- Fix : division par zero au niveau reactor 0 (plancher de 0,1% retabli)
- Garde-fou : palier reactor refuse si un niveau ne se rembourse pas en 10 jours — seuil calé sur l'optimum exact d'un modèle continu (0,09% de perte au pire sur 30 scénarios)
- Fix : formule de croissance du reactor sans plafond, alors qu'elle plafonne comme refinery — le palier recommandé était largement surévalué au-delà d'un certain niveau

## 3.4.1
- Perf : palier reactor recalculé toutes les 5 min (au lieu de 60 s) ou dès qu'il est atteint — 5× moins de blocages de 34 ms
- Doc : README décrivait la réserve avant reset comme globale, elle ne vise que reactor depuis 3.2.1
- Fix : palier reactor surévalué (débit de base gonflé ×3,8 par un bonus hors ligne appliqué à tort) — le reactor accaparait le budget au détriment de warehouse/refinery

## 3.2.1
- Fix : réserve avant reset bloquait à tort des achats warehouse/refinery rentables
- Fix : panneau Factory désynchronisé de la vraie décision d'achat
- Dédoublonnage : formule du débit reactor (3 copies → 1 fonction)

## 3.2.0
- Réserve avant reset étendue à reactor (il vidait le stock juste avant chaque reset)

## 3.1.0
- Recalibrage Factory après rééquilibrage du jeu (coûts, capacité, conversion refinery)
- Stratégie reactor : recherche de palier par simulation, plus de score marginal

## 3.0.0
- Renumérotation de version (convention par système : upgrades / recherches / Factory)

## 2.x — Recherches (dans l'historique, sans tag)
- Ajout du classement unifié des recherches
- Ajout Quick Start, Tier Resonance
- Ajout Factory (Power Cells, Reactor, Warehouse, Refinery)
- Calibration hors ligne sur mesure réelle

## 1.x — Upgrades (dans l'historique, sans tag)
- Achat automatique des upgrades par score attente + remboursement
- Valorisation de Cost Reduction par simulation
