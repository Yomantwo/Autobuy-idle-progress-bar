// ==UserScript==
// @name         Idle Progress Bar MMO - Helper
// @namespace    local.idle.autobuy
// @version      3.9.0
// @description  Surligne et achète l'upgrade et la recherche les plus rentables, ramasse les boîtes, sans ajouter de polling ni de communication externe
// @match        https://ipb-mmo.ereldev.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  if (window.__idleAutobuy) { console.warn('autobuy déjà chargé'); return; }
  window.__idleAutobuy = true;

  // ---------- Réglages ----------
  const WATCHDOG_MS = 60000;  // sans état reçu depuis ce délai, on va le chercher nous-mêmes
  const MAX_ACTIONS = 8;      // actions max par salve
  const BULK_MAX    = 25;     // plafond dur sur la quantité par requête
  const RESERVE     = 0;      // énergie à toujours garder de côté
  // Le jeu bloque les clients dépassant 1 appel / 3 s. Marge de 200 ms pour couvrir
  // la gigue de setTimeout et réseau.
  const MIN_REQ_GAP_MS = 3200;
  // Poids de l'attente vs remboursement. Mesuré : w=24 perd 0,2 % au reset contre 5,2 %
  // pour w=1 ; w=32 dégrade la fin de cycle.
  const WAIT_WEIGHT = 24;
  // Rythme de déconnexion estimé (2-3×/semaine). Détermine si offline dépasse income/synergy
  // dans le classement — à réajuster si le rythme change.
  const OFFLINE_DAYS_PER_WEEK = 2.5;
  // Plafond dur confirmé par l'infobulle du jeu : au-delà de 12 h le hors ligne ne rapporte
  // plus rien, quelle que soit la durée réelle de la coupure.
  const OFFLINE_CAP_HOURS = 12;
  // Socle de la part créditée hors ligne (infobulle du jeu), confirmé exact le 27/08 : voir
  // offlineMult() plus bas — mesure réelle à 0,000 % d'écart une fois les boosts globaux exclus.
  const OFFLINE_BASE_RATIO = 0.50;

  // Production apportée par un niveau de chaque générateur (avant multiplicateurs).
  const GEN = { auto: 1, advanced: 5, generatorMk3: 10 };
  // Achetées en priorité : leur gain n'est pas de l'énergie, le classement ⚡/point les
  // sous-évaluerait. factory ouvre les Power Cells, box pèse ~40% des points gagnés.
  const RESEARCH_PRIORITY = ['generatorMk3', 'factory', 'box'];
  // autoBuy absente volontairement de tout gainMap : elle taxe les upgrades de +25% sans rien
  // apporter que ce script ne fasse déjà mieux.

  // Points/heure gagnés hors ligne au plein tarif, mesuré le 22-23/08 (877 pts / 14,3 h à 15 %
  // de part) : sert à valoriser offlineResearch.
  const OFFLINE_PTS_PER_HOUR = 408;
  // Apport d'un niveau, relevé sur les deux comptes : base +10 ⚡/s, dailyBonus +22,5 points
  // de pourcentage sur une récompense de base de 200 points.
  const BASE_PER_LEVEL = 10, DAILY_BONUS_PER_LEVEL = 0.225;

  const LABELS = {
    auto: 'Generator MK1', advanced: 'Generator MK2', generatorMk3: 'Generator MK3',
    income: 'Income multiplier', costReduction: 'Cost Reduction',
  };
  // Titres des cartes de l'onglet RESEARCH. generatorMk3 partage son titre avec
  // l'upgrade : sans danger une fois le surlignage restreint au bon onglet.
  const LABELS_RESEARCH = {
    base: 'Base Production', income: 'Production boost', synergy: 'Collective Synergy',
    dailyBonus: 'Daily Bonus Booster', offline: 'Offline Production',
    offlineResearch: 'Offline Research', generatorMk3: 'Generator MK3', box: 'Box Sensor',
    tierResonance: 'Tier Resonance', factory: 'Factory Access',
  };
  const LABELS_FACTORY = { reactor: 'Reactor', warehouse: 'Warehouse', refinery: 'Refinery' };
  const READY = '#22c55e';  // vert : achetable maintenant
  const WAIT  = '#f59e0b';  // orange : meilleure cible, pas encore abordable
  // --------------------------------

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Tout ce qui vient du serveur et finit dans innerHTML passe par ici : un champ piégé
  // (niveau, clé d'upgrade) s'exécuterait sinon comme du HTML dans la page du jeu.
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('fr-FR');
  const dur = s => (s < 0 || !isFinite(s)) ? '—'
    : s < 60 ? `${Math.ceil(s)}s`
    : s < 3600 ? `${Math.floor(s / 60)}m${String(Math.ceil(s % 60)).padStart(2, '0')}`
    : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

  const origFetch = window.fetch.bind(window);
  let reqs = 0;

  // Écluse : espace nos requêtes de MIN_REQ_GAP_MS. Réservation synchrone du créneau, donc
  // deux appels concurrents s'alignent l'un derrière l'autre.
  let nextSlot = 0;
  const gate = () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + MIN_REQ_GAP_MS;
    return sleep(at - now);
  };

  const post = async (url, body) => {
    await gate();
    reqs++;
    const headers = { 'X-Client': 'idle-autobuy' };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await origFetch(url, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || r.status);
    return json;
  };

  // Le jeu remet upgrades et énergie à zéro à 00:00 UTC (les recherches survivent).
  // Tout raisonnement de rentabilisation est donc borné par ce délai.
  const msToReset = () => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
  };

  // ---------- Modèle de production ----------
  // Inclut le bonus base : sinon mult() (= permRate/baseRate) l'absorbe et floorRate() le recompte.
  const baseRate = p => Object.entries(GEN)
    .reduce((s, [k, v]) => s + v * (p.upgrades[k] ? p.upgrades[k].level : 0),
      p.basePassiveRate + p.research.base.bonusValue);

  // Bonus temporaires (Surge, pub) gonflent la production du moment mais disparaissent.
  // On valorise les upgrades au tarif hors bonus ; les bonus ne servent qu'à l'accumulation.
  const surgeOf = p => (p.bonusActive ? p.bonusMultiplier : 1) * (p.adBonusActive ? p.adBonusMultiplier : 1);
  const permRate = p => p.passiveRate / Math.max(1, surgeOf(p));
  const mult = p => permRate(p) / Math.max(1e-9, baseRate(p));

  // Gain ⚡/s toujours hors bonus temporaires. income rapporte +10 % de la BASE, pas du total
  // déjà multiplié (costReduction traité à part dans candidates()).
  const gainOf = (type, p) => GEN[type] ? GEN[type] * mult(p)
    : type === 'income' ? 0.10 * baseRate(p) * mult(p) / (1 + 0.10 * p.upgrades.income.level)
    : 0;

  // Remise marginale réelle de Cost Reduction : additive, donc le niveau L+1 multiplie les
  // prix par (1-0,02(L+1))/(1-0,02L), pas simplement -2 %.
  const crDiscount = L => 1 - (1 - 0.02 * (L + 1)) / Math.max(0.01, 1 - 0.02 * L);

  // Croissance du coût par niveau, déduite de cost10 = cost × (r¹⁰ - 1)/(r - 1)
  const growth = u => {
    if (!u.cost10 || u.cost10 <= u.cost) return null;
    const target = u.cost10 / u.cost;
    let lo = 1.0001, hi = 3;
    for (let i = 0; i < 40; i++) {
      const r = (lo + hi) / 2;
      if ((Math.pow(r, 10) - 1) / (r - 1) < target) lo = r; else hi = r;
    }
    return (lo + hi) / 2;
  };

  // Temps garanti à la seule production (sans boîtes, événement incertain) : borne haute,
  // recalculée dès qu'une boîte tombe. Tient compte de l'extinction de la surge.
  const eta = (cost, p) => {
    const need = cost - (p.energy - RESERVE);
    if (need <= 0) return 0;
    const tSurge = p.bonusActive ? (p.bonusRemainingMs || 0) / 1000 : 0;
    if (need <= p.passiveRate * tSurge) return need / p.passiveRate;
    return tSurge + (need - p.passiveRate * tSurge) / permRate(p);
  };

  // Classées par ATTENTE + REMBOURSEMENT : unifie épargne (attente>0) et ratio pur (attente=0).
  // Cost Reduction valorisée par l'énergie économisée d'ici le reset, pas par un % de prod.
  const candidates = p => {
    const list = [];
    for (const [type, u] of Object.entries(p.upgrades)) {
      if (type === 'costReduction' || u.locked) continue;
      if (u.maxLevel != null && u.level >= u.maxLevel) continue;
      const gain = gainOf(type, p);
      if (gain > 0) list.push({ type, u, cost: u.cost, gain, ratio: gain / u.cost });
    }
    const cr = p.upgrades.costReduction;
    if (list.length && cr && !cr.locked && (cr.maxLevel == null || cr.level < cr.maxLevel)) {
      const rho = Math.max(...list.map(c => c.ratio));
      const spendable = Math.max(0, p.energy - RESERVE) + permRate(p) * (msToReset() / 1000);
      const gain = rho * crDiscount(cr.level) * spendable;
      list.push({ type: 'costReduction', u: cr, cost: cr.cost, gain, ratio: gain / cr.cost });
    }
    for (const c of list) {
      c.wait = eta(c.cost, p);
      c.payback = c.cost / c.gain;
      c.breakeven = WAIT_WEIGHT * c.wait + c.payback;
    }
    return list.sort((a, b) => a.breakeven - b.breakeven);
  };

  // Simulation locale jusqu'au reset : coûts géométriques, gains linéaires, K constant, sans
  // boîtes ni bonus. startLvl override le point de départ des générateurs (sert à Quick Start).
  const simulate = (p, T, firstType, startLvl) => {
    const lvl = {}, cost = {}, r = {}, max = {};
    for (const [type, u] of Object.entries(p.upgrades)) {
      if (u.locked) continue;
      r[type] = growth(u) || 1.2; max[type] = u.maxLevel;
      const l0 = startLvl && startLvl[type] != null ? startLvl[type] : u.level;
      lvl[type] = l0; cost[type] = u.cost * Math.pow(r[type], l0 - u.level);
    }
    let base = startLvl
      ? p.basePassiveRate + p.research.base.bonusValue
        + (lvl.auto || 0) + 5 * (lvl.advanced || 0) + GEN.generatorMk3 * (lvl.generatorMk3 || 0)
      : baseRate(p);
    let inc = lvl.income || 0;
    // K (synergie collective + bonus externes) toujours calibré sur l'état RÉEL, jamais sur
    // startLvl — sinon un départ plus haut réduit K en retour et annule son propre bénéfice.
    const K = permRate(p) / Math.max(1e-9, baseRate(p) * (1 + 0.1 * p.upgrades.income.level));
    const rate = () => base * (1 + 0.1 * inc) * K;
    const prodGain = k => k === 'income' ? 0.1 * base * K : GEN[k] * (1 + 0.1 * inc) * K;
    const gain = (k, E, tNow) => {
      if (k !== 'costReduction') return prodGain(k);
      const prod = Object.keys(lvl).filter(x => x !== 'costReduction');
      if (!prod.length) return 0;
      const rho = Math.max(...prod.map(x => prodGain(x) / cost[x]));
      return rho * crDiscount(lvl.costReduction) * (E + rate() * (T - tNow));
    };

    let E = startLvl ? 0 : p.energy - RESERVE, t = 0, produced = 0, first = true;
    let run = 0, streak = true; // combien de fois le plan rachète le type d'entrée
    // 3000 pas si startLvl (repart de bas, doit grimper beaucoup) sinon 400 suffit (départ au
    // niveau actuel, peu d'achats avant le reset).
    for (let step = 0; step < (startLvl ? 3000 : 400) && t < T; step++) {
      const opts = Object.keys(lvl).filter(k => max[k] == null || lvl[k] < max[k]);
      if (!opts.length) break;
      const score = k => WAIT_WEIGHT * Math.max(0, (cost[k] - E) / rate()) + cost[k] / gain(k, E, t);
      const c = first && firstType ? firstType : opts.sort((a, b) => score(a) - score(b))[0];
      first = false;
      if (cost[c] == null) break;
      const dt = Math.max(0, (cost[c] - E) / rate());
      if (t + dt >= T) break;
      produced += rate() * dt; E += rate() * dt - cost[c]; t += dt;
      if (streak && c === firstType) run++; else streak = false;
      lvl[c]++; cost[c] *= r[c];
      if (c === 'income') inc++;
      else if (c === 'costReduction') {
        const f = 1 - crDiscount(lvl.costReduction - 1); // lvl vient d'être incrémenté
        for (const k in cost) if (k !== 'costReduction') cost[k] *= f;
      } else base += GEN[c];
    }
    return { produced: produced + rate() * (T - t), run: Math.max(1, run) };
  };

  // best=cible visée, pick=achat immédiat (ou rien), wait=attente, proj=production projetée,
  // qty=niveaux groupés (repris de la simulation, coûts montant ~20 %/niveau).
  const plan = p => {
    const T = msToReset() / 1000;
    const list = candidates(p);
    if (!list.length) return { best: null, pick: null, wait: 0, T, proj: 0, qty: 1, list };
    const budget = p.energy - RESERVE;
    // Chaque candidat comparé par simulation directe (dérouler la branche jusqu'au reset) : le
    // score ne sert qu'à trier l'affichage, la décision vient de la production réellement simulée.
    let best = list[0], sim = simulate(p, T, best.type);
    for (const c of list.slice(1)) {
      const s = simulate(p, T, c.type);
      if (s.produced > sim.produced) { best = c; sim = s; }
    }
    // Cible non payable = on ÉPARGNE, sauf si elle est hors d'atteinte avant le reset (l'énergie
    // serait condamnée) : on prend alors le meilleur abordable.
    const wait = best.wait;
    const pick = best.cost <= budget ? best
      : wait < T ? null
      : list.find(c => c.cost <= budget) || null;
    let qty = 1;
    if (pick) {
      const n = pick === best ? sim.run : simulate(p, T, pick.type).run;
      const room = pick.u.maxLevel != null ? pick.u.maxLevel - pick.u.level : Infinity;
      qty = Math.max(1, Math.min(n, pick.u.maxAffordable || 1, room, BULK_MAX));
    }
    return { best, pick, wait, T, proj: sim.produced, qty, list };
  };

  // ---------- Recherches ----------
  // Secondes hors ligne par jour en moyenne, d'après le rythme déclaré.
  const offlineSecPerDay = () => OFFLINE_DAYS_PER_WEEK * OFFLINE_CAP_HOURS * 3600 / 7;
  // Part de la production créditée hors ligne : socle (infobulle) + 1 point par niveau.
  const offlineRatio = p => OFFLINE_BASE_RATIO + 0.01 * p.research.offline.level;
  // Bonus PERSONNEL seul (income) : le dev confirme que les boosts GLOBAUX (Collective
  // Synergy, agrégée entre joueurs) ne s'appliquent pas hors ligne, contrairement à mult(p).
  const offlineMult = p => 1 + 0.01 * p.research.income.level;
  // Palier garanti par Quick Start sur MK1/MK2/MK3 : pct × meilleur niveau jamais atteint.
  // ceil, pas floor : à 20 % de 95/59/51 le jeu accorde 19/12/11, seul ceil reproduit les trois.
  const quickStartHeadstart = (p, lvl) => {
    const pct = 0.05 * lvl, hs = {};
    for (const t of ['auto', 'advanced', 'generatorMk3']) {
      hs[t] = Math.ceil(pct * (p.upgrades[t].bestLevel ?? p.upgrades[t].level));
    }
    return hs;
  };
  // Production qui survit au reset : la recherche base tient, les upgrades repartent de zéro
  // sauf MK1/MK2/MK3 si Quick Start garantit un palier.
  const floorRate = p => {
    const hs = quickStartHeadstart(p, p.research.quickStart.level);
    const base = p.basePassiveRate + p.research.base.bonusValue
      + hs.auto + 5 * hs.advanced + GEN.generatorMk3 * hs.generatorMk3;
    return base * offlineMult(p);
  };
  // ⚡/jour apportés par un niveau de plus. Un seul critère pour les recherches qui
  // produisent de l'ÉNERGIE ; c'est ensuite gain/coût qui décide entre elles.
  const RESEARCH_GAIN = {
    // Le jeu applique un facteur (1+0,01×niveau) : le niveau L+1 ne rapporte donc pas 1 % du
    // total actuel mais 0,01/(1+0,01L), sinon le gain est surestimé et croît avec le niveau.
    income:  p => permRate(p) * 0.01 / (1 + 0.01 * p.research.income.level) * 86400,
    synergy: p => permRate(p) * 0.01 / (1 + 0.01 * p.research.synergy.level) * 86400,
    // +1 %/tier atteint, plafonné à 5×niveau tiers comptés (formule confirmée dans le bundle
    // du jeu) : rendements décroissants une fois le plafond au-delà de maxTierReached.
    tierResonance: p => {
      const lvl = p.research.tierResonance.level;
      const bonus = l => 0.01 * Math.min(p.maxTierReached, 5 * l);
      return permRate(p) * (bonus(lvl + 1) - bonus(lvl)) * 86400;
    },
    // Un niveau vaut +10 ⚡/s de base (relevé sur les deux comptes), pas +1 : la valoriser à
    // l'unité la sous-estimait d'un facteur 10. Agit sur le cycle actif ET le plancher hors ligne.
    base: p => BASE_PER_LEVEL * (mult(p) * 86400
      + offlineMult(p) * offlineSecPerDay() * offlineRatio(p)),
    // +1 point de pourcentage sur la part créditée hors ligne, appliqué au seul plancher.
    offline: p => floorRate(p) * 0.01 * offlineSecPerDay(),
    // Recherche (jamais reset) : garantit un palier de départ sur MK1/MK2/MK3 chaque jour.
    // Valorisée par simulation de branches, deux canaux comme base (actif + plancher hors ligne).
    quickStart: p => {
      const T = 86400;
      // income/costReduction sont des upgrades qui repartent de zéro au reset : les deux
      // branches simulées doivent aussi les remettre à zéro pour une comparaison équitable.
      const cur = p.research.quickStart.level;
      const hsCur = quickStartHeadstart(p, cur), hsNext = quickStartHeadstart(p, cur + 1);
      const active = simulate(p, T, null, { income: 0, costReduction: 0, ...hsNext }).produced
        - simulate(p, T, null, { income: 0, costReduction: 0, ...hsCur }).produced;

      const floorDelta = (hsNext.auto - hsCur.auto) + 5 * (hsNext.advanced - hsCur.advanced)
        + GEN.generatorMk3 * (hsNext.generatorMk3 - hsCur.generatorMk3);
      const offline = floorDelta * offlineMult(p) * offlineSecPerDay() * offlineRatio(p);

      return active + offline;
    },
  };

  // Un repli POINTS ne bat la cible ⚡ que si son remboursement tient dans la moitié de
  // l'horizon : 30 j correspond à un horizon de 60 j, les points épargnés ne périmant pas.
  const POINTS_PAYBACK_DAYS = 30;
  // offlineResearch/dailyBonus rapportent des POINTS : les comparer dans leur propre monnaie
  // plutôt que de les convertir en ⚡ via income, ce qui les condamnait d'avance.
  const POINTS_GAIN = {
    offlineResearch: () => 0.01 * (OFFLINE_PTS_PER_HOUR / 3600) * offlineSecPerDay(),
    dailyBonus: p => (p.dailyBonus.researchReward / (1 + p.research.dailyBonus.bonusValue)) * DAILY_BONUS_PER_LEVEL,
  };

  const researchUsable = (p, t) => {
    const r = p.research[t];
    return (!r || (r.maxLevel != null && r.level >= r.maxLevel)) ? null : r;
  };

  // Meilleur score gain/coût parmi les clés de gainMap, filtré par usable() puis par affordable
  // si fourni. Factorise researchTarget (⚡, jamais filtré) et researchPurchase (points, filtré).
  const bestScored = (p, gainMap, affordable) => {
    let best = null;
    for (const type of Object.keys(gainMap)) {
      const r = researchUsable(p, type);
      if (!r || (affordable && r.cost > p.researchPoints)) continue;
      const score = gainMap[type](p) / r.cost;
      if (!best || score > best.score) best = { type, cost: r.cost, score };
    }
    return best;
  };

  // Cible visée, abordable ou non : on ÉPARGNE plutôt que de se rabattre sur l'abordable, qui
  // dégénère vers la recherche la moins chère rachetée en boucle.
  const researchTarget = p => {
    for (const type of RESEARCH_PRIORITY) {
      const r = researchUsable(p, type);
      if (r) return { type, cost: r.cost };
    }
    return bestScored(p, RESEARCH_GAIN);
  };

  // Achat réel : la cible ⚡ si payable, sinon un repli POINTS — mais seulement s'il se rembourse
  // assez vite, sinon on épargne : ces points valent plus placés sur la cible ⚡.
  const researchPurchase = p => {
    const target = researchTarget(p);
    if (target && target.cost <= p.researchPoints) return target;
    const alt = bestScored(p, POINTS_GAIN, true);
    if (!alt) return null;
    const gain = POINTS_GAIN[alt.type](p);
    return (gain > 0 && alt.cost / gain <= POINTS_PAYBACK_DAYS) ? alt : null;
  };

  // ---------- Factory ----------
  // Part prélevée par reactor : linéaire et sans plafond depuis la refonte (relevé sur 2 comptes).
  const REACTOR_PCT_MIN = 0.000026, REACTOR_PCT_STEP = 0.00001;
  const reactorPct = L => REACTOR_PCT_MIN + REACTOR_PCT_STEP * L;
  // Débit déduit de bonusValue, jamais recalculé depuis la production : cette inversion reste
  // exacte quelle que soit la base employée par le jeu (totale ou hors bonus).
  const factoryBaseRate = p => p.factory.reactor.bonusValue / reactorPct(p.factory.reactor.level);
  // Débit courant réel (Power Cells/s) déduit du niveau reactor actuel.
  const factoryRate = p => factoryBaseRate(p) * reactorPct(p.factory.reactor.level);
  // Coûts linéaires identiques pour les trois bâtiments, relevés sur les deux comptes.
  const FACTORY_COST0 = 500, FACTORY_SLOPE = 4235, WAREHOUSE_STEP = 4750;
  const factoryCap = Lw => 5000 + WAREHOUSE_STEP * Lw;
  // Refinery redevenue linéaire et sans plafond avec la refonte : +0,4 point par niveau.
  const factoryConv = Lf => 0.02 + 0.004 * Lf;
  // Dépense cumulée pour atteindre un niveau : somme des coûts, donc quadratique.
  const factorySpent = L => FACTORY_COST0 * L + FACTORY_SLOPE * L * (L - 1) / 2;

  // Répartition du budget maximisant la croissance à long terme, résolue analytiquement.
  // Le budget d'un jour vaut production − capacité : le reactor le crée, le warehouse le consomme.
  const factoryAllocation = p => {
    const P = REACTOR_PCT_STEP * 86400 * factoryBaseRate(p);
    const q = WAREHOUSE_STEP / Math.max(1e-9, P);
    const r = (3 * q + Math.sqrt(9 * q * q + 8)) / 2;
    const y = 1 / (r * r + 1 + (r - q) * r / 2);
    return { reactor: r * r * y, warehouse: y, refinery: (r - q) * r * y / 2 };
  };

  // Un score marginal est aveugle ici : agrandir le warehouse augmente la récolte mais réduit
  // d'autant le budget, si bien que le glouton finit par s'étrangler. On suit donc la répartition.
  const factoryDirectTarget = p => {
    const part = factoryAllocation(p);
    const lv = { reactor: p.factory.reactor.level, warehouse: p.factory.warehouse.level, refinery: p.factory.refinery.level };
    const total = factorySpent(lv.reactor) + factorySpent(lv.warehouse) + factorySpent(lv.refinery);
    const retard = t => total * part[t] - factorySpent(lv[t]);
    const ordre = ['reactor', 'warehouse', 'refinery'].sort((a, b) => retard(b) - retard(a));
    // Le plus en retard d'abord ; s'il dépasse la capacité maximale il ne sera jamais payable.
    for (const type of ordre) {
      const cost = p.factory[type].cost;
      if (cost <= p.powerCellsCapacity) return { type, cost, part: part[type] };
    }
    return null;
  };
  const factoryTarget = p => factoryDirectTarget(p);
  // Acheter tôt dans la journée : il faut pouvoir regagner la dépense avant le reset, sinon
  // la récolte du soir paie l'achat alors qu'attendre le lendemain ne coûte rien.
  const factoryPurchase = p => {
    const t = factoryTarget(p);
    if (!t || t.cost > p.powerCells) return null;
    // Le jeu refuse l'amélioration du warehouse tant que le stock n'est pas plein (le coût
    // affiché est erroné, bug signalé par le dev) : sans ça on le harcèle de requêtes rejetées.
    if (t.type === 'warehouse' && p.powerCells < p.powerCellsCapacity) return null;
    const rate = factoryRate(p);
    if (rate > 0 && t.cost / rate > msToReset() / 1000) return null;
    return t;
  };

  // ---------- Surlignage ----------
  // Styles inline (survit aux re-renders) ; MK3 existe en upgrade ET recherche, filtrer par carte visible.
  let marked = null;
  const cardOf = label => {
    for (const el of document.querySelectorAll('p.font-semibold')) {
      if (el.textContent.trim() !== label) continue;
      const card = el.closest('div.rounded-lg');
      if (card && card.offsetParent !== null) return card;
    }
    return null;
  };

  // Onglet actif déduit d'une carte qui lui est propre : le jeu affiche les onglets en
  // capitales CSS, comparer au texte affiché ne matchait jamais.
  const getActiveTab = () =>
    cardOf('Cost Reduction') ? 'upgrades'
    : cardOf('Collective Synergy') ? 'research'
    : cardOf('Reactor') ? 'factory'
    : null;
  const clearMark = () => {
    if (!marked) return;
    marked.style.outline = marked.style.outlineOffset = marked.style.boxShadow = marked.style.background = '';
    marked = null;
  };
  const mark = (label, affordable) => {
    const card = cardOf(label);
    if (card !== marked) clearMark();
    if (!card) return;
    const c = affordable ? READY : WAIT;
    card.style.outline = `2px solid ${c}`;
    card.style.outlineOffset = '2px';
    card.style.boxShadow = `0 0 14px ${c}66`;
    card.style.background = `${c}14`;
    marked = card;
  };

  // ---------- Panneau ----------
  const KEY_BOX = 'idleAutobuy.box';
  let autoBox = localStorage.getItem(KEY_BOX) !== '0';
  // Trois bascules indépendantes : ex. garder la Factory en manuel tout en laissant
  // tourner les upgrades.
  const AUTO_CATS = { upgrade: '⚡', research: '🔬', factory: '🏭' };
  const autos = {};
  for (const c in AUTO_CATS) autos[c] = localStorage.getItem('idleAutobuy.' + c) !== '0';
  let bought = 0, boxes = 0;
  const log = [];

  const box = document.createElement('div');
  box.style.cssText = `
    position:fixed; right:16px; bottom:16px; z-index:2147483647; width:250px;
    font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:#e2e8f0;
    background:rgba(15,23,42,.95); border:1px solid #334155; border-radius:10px;
    box-shadow:0 8px 24px rgba(0,0,0,.5); user-select:none;`;
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #334155">
      <span id="ab-dot" style="width:8px;height:8px;border-radius:50%;flex:none"></span>
      <b style="flex:1;font-size:11px;letter-spacing:.05em;text-transform:uppercase">Helper</b>
      <button id="ab-min" style="all:unset;cursor:pointer;padding:0 4px;color:#94a3b8">–</button>
      <button id="ab-toggle" style="all:unset;cursor:pointer;padding:2px 10px;border-radius:4px;font-weight:600;font-size:11px"></button>
    </div>
    <div id="ab-body" style="padding:8px 10px;display:flex;flex-direction:column;gap:4px">
      <div id="ab-stats" style="color:#94a3b8">en attente du 1er état…</div>
      <div id="ab-surge" style="color:#64748b;font-size:11px"></div>
      <div id="ab-target" style="color:#e2e8f0">—</div>
      <div id="ab-hold" style="color:#64748b;font-size:11px"></div>
      <div id="ab-autos" style="color:#94a3b8"></div>
      <div id="ab-research" style="color:#94a3b8;font-size:11px"></div>
      <div id="ab-factory" style="color:#94a3b8;font-size:11px"></div>
      <div id="ab-box" style="cursor:pointer;color:#94a3b8" title="Cliquer pour activer/désactiver le ramassage des boîtes"></div>
      <div id="ab-net" style="color:#475569;font-size:11px"></div>
      <div id="ab-log" style="margin-top:4px;padding-top:6px;border-top:1px solid #1e293b;color:#64748b;min-height:52px"></div>
    </div>`;
  document.body.appendChild(box);

  const $ = id => box.querySelector('#ab-' + id);
  const anyAuto = () => Object.values(autos).some(v => v);
  const paint = () => {
    const b = $('toggle'), all = Object.values(autos).every(v => v);
    b.textContent = 'TOUT';
    b.style.background = all ? '#16a34a' : '#475569';
    b.style.color = '#fff';
    b.title = all ? 'tout désactiver' : 'tout activer';
    $('dot').style.background = anyAuto() ? READY : '#64748b';
    $('dot').title = anyAuto() ? 'achats automatiques actifs' : 'achats en pause (analyse toujours active)';
    $('autos').innerHTML = Object.entries(AUTO_CATS)
      .map(([c, icon]) => `<span data-c="${c}" style="cursor:pointer;color:${autos[c] ? READY : '#64748b'}">${icon} ${autos[c] ? 'ON' : 'OFF'}</span>`)
      .join('  ');
    $('box').innerHTML = `📦 boîtes : <b style="color:${autoBox ? READY : '#64748b'}">${autoBox ? 'AUTO' : 'OFF'}</b> · ${boxes} ramassées`;
  };
  $('toggle').onclick = () => {
    const target = !Object.values(autos).every(v => v);
    for (const c in autos) { autos[c] = target; localStorage.setItem('idleAutobuy.' + c, target ? '1' : '0'); }
    paint(); schedule();
  };
  $('autos').onclick = e => {
    const c = e.target.dataset.c;
    if (!c) return;
    autos[c] = !autos[c];
    localStorage.setItem('idleAutobuy.' + c, autos[c] ? '1' : '0');
    paint(); schedule();
  };
  $('box').onclick = () => {
    autoBox = !autoBox;
    localStorage.setItem(KEY_BOX, autoBox ? '1' : '0');
    paint(); schedule();
  };
  $('min').onclick = () => {
    const body = $('body');
    body.style.display = body.style.display === 'none' ? 'flex' : 'none';
  };
  const addLog = line => {
    log.unshift(line);
    log.length = Math.min(log.length, 3);
    $('log').innerHTML = log.map(l => `<div>${esc(l)}</div>`).join('');
  };
  paint();

  // ---------- Affichage ----------
  // Entre deux états reçus, on extrapole l'énergie localement : aucun appel réseau.
  let snap = null, snapAt = 0, lastSeen = 0;

  const render = p => {
    $('stats').textContent = `${fmt(p.energy)} ⚡ · +${fmt(p.passiveRate)}/s · ${bought} achats`;
    const s = surgeOf(p);
    const { best, pick, wait, T, list } = plan(p);
    $('surge').textContent = `⏳ reset dans ${dur(T)}`
      + (s > 1 ? ` · 🎉 ×${s} ${dur((p.bonusRemainingMs || 0) / 1000)} · base ${fmt(permRate(p))}/s` : '');

    const ready = best && wait === 0;
    if (!best) {
      $('target').textContent = 'rien à acheter';
      $('target').title = '';
      $('hold').textContent = '';
    } else {
      $('target').innerHTML = `<span style="color:${ready ? READY : WAIT}">→ ${esc(LABELS[best.type] || best.type)}</span>`
        + ` · ⚡${fmt(best.cost)} · ${ready ? 'prêt' : dur(wait)}`;
      $('hold').textContent = (!ready && pick) ? `cible hors d'atteinte, achète ${LABELS[pick.type] || pick.type}` : '';
      // Le critère de décision, exposé tel quel pour pouvoir le vérifier.
      $('target').title = `Score = ${WAIT_WEIGHT} × attente + remboursement (le plus bas gagne)\n`
        + list.map(c => `${(LABELS[c.type] || c.type).padEnd(18)} ${fmt(c.cost / 1e6)}M · +${c.gain.toFixed(1)}/s`
          + ` · attente ${dur(c.wait)} · remb. ${dur(c.payback)} · score ${dur(c.breakeven)}`
          + (c.type === 'costReduction' ? ' (converti : ne produit pas)' : '')).join('\n');
    }

    const rt = researchTarget(p);
    const rAfford = rt && rt.cost <= p.researchPoints;
    $('research').innerHTML = rt
      ? `🔬 <span style="color:${rAfford ? READY : WAIT}">${esc(LABELS_RESEARCH[rt.type] || rt.type)}</span>`
        + ` · ${fmt(rt.cost)} (${fmt(p.researchPoints)} dispo)`
        + (rAfford ? '' : ' · ⏸')
      : '🔬 rien à chercher';

    const ft = p.factory ? factoryTarget(p) : null;
    // Reflète l'achat RÉEL (factoryPurchase), pas la simple affordabilité : sinon le panneau
    // affichait « prêt » juste avant reset alors que la réserve bloquait l'achat.
    const fAfford = ft && !!(p.factory && factoryPurchase(p));
    const fRate = p.factory ? factoryRate(p) : 0;
    const fRoom = p.factory ? p.powerCellsCapacity - p.powerCells : 0;
    const fFull = p.factory && fRoom > 0 && fRate > 0 ? ` · plein dans ${dur(fRoom / fRate)}` : '';
    // Le stock suffit mais l'achat est quand même refusé : dit pourquoi, sinon le ⏸ générique
    // ne distingue pas « attend le plein » (exigé par le jeu) de « reset trop proche ».
    let fNote = '';
    if (ft && !fAfford && ft.cost <= p.powerCells) {
      if (ft.type === 'warehouse' && p.powerCells < p.powerCellsCapacity) fNote = ' · attend le plein';
      else if (fRate > 0 && ft.cost / fRate > msToReset() / 1000) fNote = ' · reset trop proche';
    }
    $('factory').innerHTML = !p.factory ? ''
      : ft
      ? `🏭 <span style="color:${fAfford ? READY : WAIT}">${esc(LABELS_FACTORY[ft.type])}</span>`
        + ` · ${fmt(ft.cost)} (${fmt(p.powerCells)} 🔋)`
        + (fAfford ? '' : ' · ⏸') + fNote + fFull
      : `🏭 <span style="color:${WAIT}">Attente du remplissage</span>${fFull}`;

    // Le surlignage suit l'onglet affiché : upgrade cible sur UPGRADES, recherche cible
    // sur RESEARCH, rien sur STORE ou si l'onglet actif n'est pas identifiable.
    const tab = getActiveTab();
    if (tab === 'upgrades' && best) mark(LABELS[best.type] || best.type, ready);
    else if (tab === 'research' && rt) mark(LABELS_RESEARCH[rt.type] || rt.type, rAfford);
    else if (tab === 'factory' && ft) mark(LABELS_FACTORY[ft.type], fAfford);
    else clearMark();
  };

  setInterval(() => {
    if (!snap) return;
    const el = Date.now() - snapAt;
    const left = Math.max(0, (snap.bonusRemainingMs || 0) - el); // la surge s'écoule aussi
    render({
      ...snap,
      energy: snap.energy + snap.passiveRate * el / 1000,
      bonusRemainingMs: left,
      bonusActive: snap.bonusActive && left > 0,
    });
    $('net').textContent = `🔌 état reçu il y a ${dur((Date.now() - lastSeen) / 1000)} · ${reqs} req. ajoutées`;
  }, 1000);

  // ---------- Actions ----------
  let latest = null, busy = false;

  // Nos POST renvoient l'état complet : on l'adopte pour ne pas raisonner (ni afficher)
  // sur une énergie déjà dépensée. lastSeen reste réservé au suivi du polling de la page.
  const adopt = q => { latest = q; snap = q; snapAt = Date.now(); render(q); };

  // Un achat refusé se reproduirait à chaque état reçu : on met les achats en pause le temps
  // que la situation change, plutôt que de marteler le serveur d'appels voués à l'échec.
  const ACT_BACKOFF_MS = 60000;
  let actPausedUntil = 0;
  const act = async () => {
    if (busy || !latest || Date.now() < actPausedUntil) return;
    busy = true;
    try {
      let p = latest;
      for (let i = 0; i < MAX_ACTIONS; i++) {
        // Boîte d'abord : son énergie compte pour l'achat qui suit.
        if (autoBox && p.box && p.box.available) {
          const res = await post('/api/box/claim');
          const rw = res.boxReward;
          if (rw) { boxes++; addLog(`📦 +${fmt(rw.energy)} ⚡ · +${fmt(rw.researchPoints)} 🔬`); }
          p = res.player;
          adopt(p); paint();
          continue;
        }
        const { pick, qty } = autos.upgrade ? plan(p) : {};
        const re = autos.research ? researchPurchase(p) : null;
        const fa = autos.factory && p.factory ? factoryPurchase(p) : null;
        if (!pick && !re && !fa) break;

        if (pick) {
          const res = await post('/api/upgrade', { type: pick.type, quantity: qty });
          bought += qty;
          p = res.player;
          addLog(`⚡ ${LABELS[pick.type] || pick.type} ×${qty} → niv.${p.upgrades[pick.type].level}`);
        }
        if (re) {
          const res = await post('/api/research', { type: re.type, quantity: 1 });
          p = res.player;
          addLog(`🔬 ${LABELS_RESEARCH[re.type] || re.type} → niv.${p.research[re.type].level}`);
        }
        if (fa) {
          const res = await post('/api/factory', { type: fa.type, quantity: 1 });
          p = res.player;
          addLog(`🏭 ${LABELS_FACTORY[fa.type]} → niv.${p.factory[fa.type].level}`);
        }
        adopt(p); // l'espacement des requêtes est assuré par gate()
      }
    } catch (e) {
      actPausedUntil = Date.now() + ACT_BACKOFF_MS;
      $('target').textContent = 'erreur : ' + e.message;
    } finally {
      busy = false;
    }
  };
  const schedule = () => { if (!busy) act(); };

  const onState = p => {
    latest = p; snap = p;
    snapAt = lastSeen = Date.now();
    render(p); schedule();
  };

  // ---------- Interception ----------
  // La page poll déjà /api/state toutes les 3 s : on lit ses réponses au passage, zéro lecture ajoutée.
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (url.includes('/api/')) {
        res.clone().json().then(j => { if (j && j.player) onState(j.player); }).catch(() => {});
      }
    } catch (e) { /* on ne casse jamais le fetch de la page */ }
    return res;
  };

  // Filet de sécurité : si la page cesse de poller, on va chercher l'état nous-mêmes.
  setInterval(async () => {
    if (Date.now() - lastSeen < WATCHDOG_MS) return;
    try {
      await gate();
      reqs++;
      const r = await origFetch('/api/state', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.player) onState(j.player);
    } catch (e) { /* réseau coupé : on retentera */ }
  }, 15000);

  console.log('helper v3.9.0 chargé — lecture passive du polling de la page');
})();
