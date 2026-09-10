# Changelog

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
