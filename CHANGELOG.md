# Changelog

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
