/* Route Bloomberg engine v6.2 — NY→EU→UK triangular customs risk analysis */
window.JURISDICTIONS = window.JURISDICTIONS || null;
window.EU_CET = window.EU_CET || null;
window.currentRouteAnalysis = window.currentRouteAnalysis || null;
window.currentRouteProduct = window.currentRouteProduct || null;

async function loadRouteData() {
  if (window.JURISDICTIONS && window.EU_CET) return true;
  const base = document.querySelector('base')?.href || (location.pathname.replace(/\/[^/]*$/, '/') || '/');
  const prefix = location.pathname.includes('/tracking') ? 'data/' : 'tracking/data/';
  const urls = [prefix + 'jurisdictions.json', prefix + 'eu-cet-chapters.json', 'data/jurisdictions.json', 'data/eu-cet-chapters.json'];
  let jData = null, cData = null, lastErr = '';
  for (let attempt = 0; attempt < 2 && !jData; attempt++) {
    for (const ju of [urls[attempt * 2], urls[0], 'data/jurisdictions.json']) {
      try {
        const r = await fetch(ju);
        if (r.ok) { jData = await r.json(); break; }
        lastErr = ju + ' HTTP ' + r.status;
      } catch (e) { lastErr = e.message; }
    }
    for (const cu of [urls[attempt * 2 + 1], urls[1], 'data/eu-cet-chapters.json']) {
      try {
        const r = await fetch(cu);
        if (r.ok) { cData = await r.json(); break; }
        lastErr = cu + ' HTTP ' + r.status;
      } catch (e) { lastErr = e.message; }
    }
  }
  if (!jData || !cData) throw new Error('EU route data failed: ' + lastErr);
  window.JURISDICTIONS = jData;
  window.EU_CET = cData;
  return true;
}

function getEuDutyRate(product) {
  const ch = String(product.chapter);
  if (product.euDuty != null) return product.euDuty;
  return window.EU_CET?.chapters?.[ch] ?? product.duty ?? 0;
}

function hubChapterBonus(hub, chapter) {
  return hub.chapterAdj?.[chapter] || hub.chapterAdj?.[String(chapter)] || 0;
}

function hubStrengthMatch(hub, product) {
  const ch = product.chapter;
  const strengths = hub.hubStrength || [];
  const tags = {
    machinery: ch >= 84 && ch <= 86,
    electronics: ch === 85,
    automotive: ch === 87,
    industrial: ch >= 72 && ch <= 83,
    'sea-freight': freightMode === 'sea',
    pharma: ch === 30,
    food: ch >= 1 && ch <= 24,
    wine: ch === 22,
    luxury: ch === 71 || ch === 33,
    textiles: ch >= 50 && ch <= 63,
    furniture: ch === 94,
    tech: ch === 85 || ch === 90,
    consolidation: freightMode === 'sea',
  };
  let bonus = 0;
  strengths.forEach(s => { if (tags[s]) bonus -= 2; });
  return bonus;
}

function euRestrictionRisk(product, hub) {
  if (!product.restrictions?.length) return 0;
  let pts = restrictionRisk(product);
  const types = product.restrictions.map(r => r.type);
  if (types.includes('SPS') || types.includes('PHYTO')) pts += 2;
  if (types.includes('EXCISE')) pts += 3;
  if (hub.code === 'NL' || hub.code === 'DE') pts = Math.max(0, pts - 3);
  if (hub.code === 'ES' || hub.code === 'RO' || hub.code === 'HU') pts += 2;
  return Math.min(40, pts);
}

function scoreUsToEu(product, inputWeight, inputDims, hub) {
  const phys = physicalCoherence(product, inputWeight, inputDims);
  const breakdown = { ...phys.breakdown };

  const dq = descQualityScore(product);
  breakdown.desc = dq >= 8 ? 0 : dq >= 6 ? 3 : dq >= 4 ? 8 : 16;
  breakdown.hs = classificationRisk(product);
  breakdown.restricted = euRestrictionRisk(product, hub);
  breakdown.flags = flagRisk(product);

  if (product.used) {
    const hasCond = /used|pre-owned|second|refurb|antique|decommission|tested/i.test(product.desc || '');
    breakdown.used = hasCond ? 3 : 15;
  } else breakdown.used = 0;

  breakdown.valuation = valuationRisk(product, phys.wtDelta);
  const euDuty = getEuDutyRate(product);
  if (euDuty > 14) breakdown.duty = 6;
  else if (euDuty > 8) breakdown.duty = 4;
  else if (euDuty > 3) breakdown.duty = 2;
  else breakdown.duty = 0;

  breakdown.freight = modeFitRisk(product, inputWeight, inputDims);
  breakdown.jurisdiction = (hub.scrutinyBase || 0) + (hub.firstLegAdj || 0);
  breakdown.hubFit = hubChapterBonus(hub, product.chapter) + hubStrengthMatch(hub, product);

  let risk = 6 + Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (phys.wtDelta <= 2 && phys.dimDiff <= 6 && phys.shipGap <= 5 && (product.conf || 0) >= 0.93 && !product.restrictions?.length)
    risk -= 6;

  const score = Math.max(4, Math.min(96, Math.round(risk)));
  return { score, breakdown, ...phys, euDuty, hub: hub.code };
}

function euOriginUkRestrictionRisk(product, hub) {
  if (!product.restrictions?.length) return 0;
  let pts = 0;
  product.restrictions.forEach(r => {
    if (r.type === 'SPS' || r.type === 'PHYTO') pts += 5;
    else if (r.type === 'EXCISE') pts += 6;
    else if (r.type === 'REACH') pts += 3;
    else pts += 4;
  });
  if (hub.code === 'IE') pts += 2;
  return Math.min(28, pts);
}

function scoreEuOriginToUk(product, hub, inputWeight, inputDims) {
  const e2u = hub.euToUk;
  const phys = physicalCoherence(product, inputWeight, inputDims);
  const breakdown = {};

  breakdown.tcaBase = e2u.leg2BaseEuOrigin ?? Math.max(4, (e2u.leg2Base || 12) - 6);
  breakdown.weight = Math.round((phys.breakdown.weight || 0) * 0.55);
  breakdown.dims = Math.round((phys.breakdown.dims || 0) * 0.55);
  breakdown.shipGap = Math.round((phys.breakdown.shipGap || 0) * 0.45);
  breakdown.density = Math.round((phys.breakdown.density || 0) * 0.5);

  const dq = descQualityScore(product);
  breakdown.desc = dq >= 7 ? 0 : dq >= 5 ? 2 : 6;
  breakdown.hs = Math.max(0, classificationRisk(product) - 5);
  breakdown.restricted = euOriginUkRestrictionRisk(product, hub);
  breakdown.flags = Math.round(flagRisk(product) * 0.65);
  breakdown.duty = product.duty > 0 ? 1 : 0;
  breakdown.originDoc = (product.conf || 0) >= 0.9 ? 0 : (product.conf || 0) >= 0.85 ? 2 : 5;
  breakdown.tcaFiling = 3;
  breakdown.transit = Math.min(4, Math.round((e2u.ferryHours || 24) / 22));

  if (product.used) breakdown.used = 4;
  else breakdown.used = 0;

  let risk = 3 + Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (product.chapter >= 84 && product.chapter <= 96) risk -= 2;
  if (['NL', 'FR', 'BE', 'DE'].includes(hub.code)) risk -= 2;
  if (hub.chapterAdj?.[product.chapter] || hub.chapterAdj?.[String(product.chapter)]) {
    risk += Math.max(0, hub.chapterAdj[product.chapter] || hub.chapterAdj[String(product.chapter)] || 0) * 0.3;
  }

  const score = Math.max(4, Math.min(96, Math.round(risk)));
  const ukDutyPref = product.duty > 0 ? 0 : 0;

  return {
    score,
    breakdown,
    origin: hub.code,
    originLabel: hub.name + ' (EU origin)',
    preferenceCode: e2u.preferenceCode || '300',
    preferenceLabel: e2u.preferenceLabel || 'UK-EU TCA preferential',
    ukDuty: ukDutyPref,
    ukDutyNote: 'TCA pref — 0% duty if EU origin criteria met (not US third-country)',
    notes: e2u.notesEuOrigin || e2u.notes,
    ukEntry: e2u.ukEntry,
    exportSystem: e2u.exportSystem,
    corridor: hub.ukCorridor,
    mode: 'eu_origin',
  };
}

function riskToStress(score) {
  return Math.min(0.95, Math.max(0.05, (score - 4) / 92));
}

function stressToRisk(stress) {
  return Math.round(Math.max(4, Math.min(96, 4 + stress * 92)));
}

function safetyIndexFromRisk(score) {
  return Math.round(Math.max(4, Math.min(99, 100 - riskToStress(score) * 100)));
}

function hubBonusPts(hub, product) {
  return Math.abs(Math.min(0, hubChapterBonus(hub, product.chapter)))
    + Math.abs(Math.min(0, hubStrengthMatch(hub, product)));
}

function computeRouteStatistics(leg1Score, leg2Score, hub, product, isDirect) {
  const tm = window.JURISDICTIONS?.triangularModel || {};
  const w = tm.weights || { rss: 0.58, union: 0.27, maxLeg: 0.15, chain: tm.chainPenalty ?? 1.0, hubBonus: 0.55 };

  if (isDirect) {
    const statistical = leg1Score;
    return {
      statistical,
      safetyIndex: safetyIndexFromRisk(statistical),
      linearSum: statistical,
      rss: statistical,
      union: statistical,
      maxLeg: statistical,
      chainPenalty: 0,
      hubBonus: 0,
      model: 'single-leg',
      explain: 'Single customs event — SRI equals direct clearance risk.',
    };
  }

  const l1 = leg1Score;
  const l2 = leg2Score;
  const s1 = riskToStress(l1);
  const s2 = riskToStress(l2);
  const rss = Math.sqrt(l1 * l1 + l2 * l2);
  const unionStress = 1 - (1 - s1) * (1 - s2);
  const union = stressToRisk(unionStress);
  const maxLeg = Math.max(l1, l2);
  const hubBonus = hubBonusPts(hub, product);
  const chainPenalty = tm.chainPenalty ?? w.chain ?? 1.0;
  const linearSum = Math.round(l1 + l2 - hubBonus * 0.5);

  const statistical = Math.round(Math.max(4, Math.min(96,
    w.rss * rss + w.union * union + w.maxLeg * maxLeg + chainPenalty - hubBonus * w.hubBonus
  )));

  const vsLinear = statistical - linearSum;
  let explain = 'SRI blend: RSS ' + Math.round(rss) + ' (vector) · Union ' + union + ' (sequential) · MaxLeg ' + maxLeg;
  if (rss < linearSum - 2) explain += ' — two moderate legs statistically safer than linear sum';
  if (statistical < Math.min(l1, l2)) explain += ' — diversification benefit vs single spike';

  return {
    statistical,
    safetyIndex: safetyIndexFromRisk(statistical),
    linearSum,
    rss: Math.round(rss * 10) / 10,
    union,
    maxLeg,
    chainPenalty,
    hubBonus,
    vsLinear,
    model: 'triangular-sri',
    explain,
  };
}

function analyzeRoutesForProduct(product, inputWeight, inputDims) {
  if (!window.JURISDICTIONS?.euHubs?.length) return null;

  const direct = scoreOption(product, inputWeight, inputDims);
  const directStats = computeRouteStatistics(direct.score, 0, null, product, true);
  const directUk = {
    route: 'JFK → ' + (getFreightConfig().entry || 'LHR') + ' (direct UK)',
    leg1: null,
    leg2: null,
    combined: directStats.statistical,
    statistical: directStats.statistical,
    safetyIndex: directStats.safetyIndex,
    linearSum: directStats.linearSum,
    stats: directStats,
    delta: 0,
    verdict: 'BASELINE',
    hub: null,
    breakdown: direct.breakdown,
  };

  const hubs = window.JURISDICTIONS.euHubs.map(hub => {
    const leg1 = scoreUsToEu(product, inputWeight, inputDims, hub);
    const leg2 = scoreEuOriginToUk(product, hub, inputWeight, inputDims);
    const stats = computeRouteStatistics(leg1.score, leg2.score, hub, product, false);
    const delta = stats.statistical - directStats.statistical;
    let verdict = 'NEUTRAL';
    if (delta <= -5) verdict = 'SAFEST VIA HUB';
    else if (delta <= -2) verdict = 'SLIGHT EDGE';
    else if (delta >= 8) verdict = 'AVOID HUB';
    else if (delta >= 4) verdict = 'DIRECT SAFER';

    return {
      hub,
      route: 'JFK → ' + hub.entryAir + ' (US→EU) → UK (' + hub.code + ' EU-origin)',
      leg1,
      leg2,
      combined: stats.statistical,
      statistical: stats.statistical,
      safetyIndex: stats.safetyIndex,
      linearSum: stats.linearSum,
      stats,
      delta,
      verdict,
      euDuty: leg1.euDuty,
      ukDuty: leg2.ukDuty,
      ukDutyNote: leg2.ukDutyNote,
      euOrigin: hub.code,
      corridor: hub.ukCorridor,
      transitDays: hub.transitDays,
    };
  });

  hubs.sort((a, b) => a.statistical - b.statistical || b.safetyIndex - a.safetyIndex);

  const betterThanDirect = hubs.filter(h => h.statistical < directStats.statistical);
  const bestHub = hubs[0] || null;
  const safest = bestHub && bestHub.statistical < directStats.statistical ? bestHub : directUk;

  return {
    direct: directUk,
    directScore: direct.score,
    directSRI: directStats.statistical,
    directSafety: directStats.safetyIndex,
    hubs,
    betterThanDirect,
    bestHub,
    safest,
    bestOverall: safest,
    recommendation: buildRouteRecommendation(directStats, bestHub, betterThanDirect),
  };
}

function buildRouteRecommendation(directStats, bestHub, betterHubs) {
  if (!bestHub) return 'Insufficient route data.';
  const dSri = directStats.statistical;
  const dSafe = directStats.safetyIndex;
  if (bestHub.statistical < dSri - 4) {
    return 'Statistical safest route: ' + bestHub.hub.code + ' (SRI ' + bestHub.statistical + ', safety ' + bestHub.safetyIndex + '/100) beats direct (SRI ' + dSri + ', safety ' + dSafe + '/100) by '
      + Math.abs(bestHub.delta) + ' pts. Legs ' + bestHub.leg1.score + '+' + bestHub.leg2.score
      + ' → linear sum ' + bestHub.linearSum + ' but RSS/union blend favours hub. ' + (bestHub.stats?.explain || '');
  }
  if (betterHubs.length > 0) {
    return betterHubs.length + ' EU hub(s) statistically safer than direct (best ' + bestHub.hub.code + ' SRI ' + bestHub.statistical + ' vs direct ' + dSri + ', Δ' + bestHub.delta + '). Linear sum would be ' + bestHub.linearSum + ' — SRI model weights moderate dual legs differently.';
  }
  return 'Direct JFK→UK is statistically safest (SRI ' + dSri + ', safety ' + dSafe + '/100). Best hub ' + bestHub.hub.code + ' SRI ' + bestHub.statistical + ' (US→EU ' + bestHub.leg1.score + ' + EU-origin→UK ' + bestHub.leg2.score + '). Leg 2 assumes ' + bestHub.hub.name + ' origin under TCA — not US pass-through.';
}

function routeVerdictClass(verdict) {
  if (verdict === 'SAFEST VIA HUB' || verdict === 'SLIGHT EDGE' || verdict === 'HUB ADVANTAGE') return 'risk-low';
  if (verdict === 'BASELINE') return 'risk-low';
  if (verdict === 'NEUTRAL') return 'risk-med';
  return 'risk-high';
}

function breakdownRows(bd, labels) {
  return Object.entries(bd).map(([k, v]) => {
    const label = labels?.[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    return '<div class="flex justify-between"><span>' + label + '</span><span>' + v + ' pts</span></div>';
  }).join('');
}

const LEG1_LABELS = {
  weight: 'Physical — weight match', dims: 'Physical — dimension fit', shipGap: 'Physical — wt/dim gap',
  density: 'Physical — density', desc: 'Documentation — desc quality', hs: 'Tariff — HS classification',
  restricted: 'Compliance — restrictions', flags: 'Compliance — sector flags', used: 'Condition — used goods',
  valuation: 'Valuation — market band', duty: 'EU CET duty factor', freight: 'Freight mode fit',
  jurisdiction: 'EU jurisdiction adj', hubFit: 'Hub chapter fit',
};

const LEG2_LABELS = {
  tcaBase: 'TCA corridor base (EU-origin)', weight: 'Physical — weight match', dims: 'Physical — dimension fit',
  shipGap: 'Physical — wt/dim gap', density: 'Physical — density', desc: 'Documentation — invoice/desc',
  hs: 'Tariff — HS & classification', restricted: 'Compliance — UK/EU controls', flags: 'Sector flags',
  duty: 'TCA preferential duty factor', originDoc: 'EU origin statement / REX', tcaFiling: 'UK CDS TCA filing',
  used: 'Used goods', transit: 'Transit time',
};

function populateRerouteHubSelect(analysis, selectedCode) {
  const sel = document.getElementById('reroute-hub-select');
  if (!sel || !analysis?.hubs) return;
  const prev = selectedCode || sel.value || analysis.bestHub?.hub?.code;
  sel.innerHTML = '';
  analysis.hubs.forEach((h, i) => {
    const opt = document.createElement('option');
    opt.value = h.hub.code;
    const star = i === 0 ? ' ★ ' : ' ';
    opt.textContent = h.hub.code + star + '· ' + h.hub.name + ' (SRI ' + h.statistical + ' · safe ' + h.safetyIndex + ')';
    sel.appendChild(opt);
  });
  sel.value = prev && analysis.hubs.some(h => h.hub.code === prev) ? prev : analysis.hubs[0]?.hub?.code;
}

function renderDetailReroute(analysis, product, hubCode) {
  if (!analysis?.hubs?.length) {
    showRerouteLegsError('No EU hub routes computed for this classification.');
    return;
  }
  populateRerouteHubSelect(analysis, hubCode);
  const code = hubCode || document.getElementById('reroute-hub-select')?.value || analysis.bestHub?.hub?.code;
  const route = analysis.hubs.find(h => h.hub.code === code) || analysis.bestHub;
  if (!route) {
    showRerouteLegsError('Selected EU hub route not found.');
    return;
  }

  const leg1El = document.getElementById('reroute-leg1');
  const leg2El = document.getElementById('reroute-leg2');
  const combEl = document.getElementById('reroute-combined');
  if (leg1El) { leg1El.textContent = route.leg1.score; leg1El.className = 'text-2xl font-bold leading-tight ' + riskClass(route.leg1.score); }
  if (leg2El) { leg2El.textContent = route.leg2.score; leg2El.className = 'text-2xl font-bold leading-tight ' + riskClass(route.leg2.score); }
  if (combEl) { combEl.textContent = route.statistical; combEl.className = 'text-2xl font-bold leading-tight ' + riskClass(route.statistical); }

  const safetyEl = document.getElementById('reroute-safety');
  if (safetyEl) {
    safetyEl.textContent = route.safetyIndex;
    safetyEl.className = 'text-lg font-bold ' + (route.safetyIndex >= 75 ? 'risk-low' : route.safetyIndex >= 55 ? 'risk-med' : 'risk-high');
  }

  const l1Label = document.getElementById('reroute-leg1-label');
  const l2Label = document.getElementById('reroute-leg2-label');
  if (l1Label) l1Label.textContent = route.hub.entryAir + ' · ' + route.hub.agency.split('·')[0].trim() + ' · EU duty ' + route.euDuty + '%';
  if (l2Label) l2Label.textContent = route.leg2.originLabel + ' · pref ' + route.leg2.preferenceCode + ' · ' + route.leg2.exportSystem + ' → ' + route.leg2.ukEntry;

  const ukEntry = document.getElementById('reroute-uk-entry');
  if (ukEntry) ukEntry.textContent = route.leg2.ukEntry || 'UK';

  const deltaEl = document.getElementById('reroute-delta');
  if (deltaEl) {
    const d = route.delta;
    deltaEl.textContent = 'SRI ' + (d >= 0 ? '+' : '') + d + ' vs direct · linear sum ' + route.linearSum;
    deltaEl.className = 'text-[8px] ' + (d < 0 ? 'risk-low' : d > 4 ? 'risk-high' : 'text-[#888]');
  }

  const cmp = document.getElementById('reroute-direct-compare');
  if (cmp) {
    const st = route.stats || {};
    cmp.innerHTML = '<div class="flex justify-between flex-wrap gap-2">'
      + '<span>Direct SRI: <strong class="' + riskClass(analysis.directSRI) + '">' + analysis.directSRI + '</strong> (safe ' + analysis.directSafety + ')</span>'
      + '<span>Hub SRI: <strong class="' + riskClass(route.statistical) + '">' + route.statistical + '</strong> (safe ' + route.safetyIndex + ')</span>'
      + '<span class="' + routeVerdictClass(route.verdict) + '">' + route.verdict + '</span></div>'
      + '<div class="text-[#666] mt-0.5">RSS ' + st.rss + ' · Union ' + st.union + ' · MaxLeg ' + st.maxLeg + ' · Chain +' + st.chainPenalty + ' · ' + (st.explain || '') + '</div>'
      + '<div class="text-[#555]">' + route.corridor + ' · ~' + route.transitDays + 'd · ' + (route.ukDutyNote || ('UK duty ' + route.ukDuty + '%')) + '</div>';
  }

  const statBd = document.getElementById('reroute-stat-breakdown');
  if (statBd && route.stats) {
    const s = route.stats;
    statBd.innerHTML = [
      ['RSS (√(leg₁²+leg₂²))', s.rss],
      ['Union (sequential exposure)', s.union],
      ['Max leg (worst checkpoint)', s.maxLeg],
      ['Chain penalty (2 customs events)', s.chainPenalty],
      ['Hub bonus', -s.hubBonus],
      ['Linear sum (reference)', s.linearSum],
      ['→ Statistical SRI', s.statistical],
    ].map(([k, v]) => '<div class="flex justify-between"><span>' + k + '</span><span>' + v + '</span></div>').join('');
  }

  const b1 = document.getElementById('reroute-leg1-breakdown');
  const b2 = document.getElementById('reroute-leg2-breakdown');
  if (b1) b1.innerHTML = breakdownRows(route.leg1.breakdown, LEG1_LABELS);
  if (b2) b2.innerHTML = breakdownRows(route.leg2.breakdown, LEG2_LABELS);

  const status = document.getElementById('reroute-status');
  if (status) status.textContent = '15 EU hubs loaded · showing ' + route.hub.code;
}

function showRerouteLegsError(msg) {
  ['reroute-leg1', 'reroute-leg2', 'reroute-combined'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '!'; el.className = 'text-2xl font-bold leading-tight risk-high'; }
  });
  const cmp = document.getElementById('reroute-direct-compare');
  if (cmp) cmp.innerHTML = '<span class="risk-high">' + msg + '</span>';
  const status = document.getElementById('reroute-status');
  if (status) status.textContent = msg;
}

function renderRouteBloomberg(analysis, product) {
  const panel = document.getElementById('route-bloomberg');
  const body = document.getElementById('route-bloomberg-body');
  const summary = document.getElementById('route-bloomberg-summary');
  if (!panel || !body || !analysis) return;

  panel.classList.remove('hidden');
  summary.innerHTML = '<div class="text-[10px] leading-relaxed text-[#aaa]">' + analysis.recommendation + '</div>'
    + '<div class="mt-2 flex gap-4 text-xs flex-wrap">'
    + '<span>Direct SRI: <strong class="' + riskClass(analysis.directSRI) + '">' + analysis.directSRI + '</strong> (safety ' + analysis.directSafety + ')</span>'
    + '<span>Statistically safer hubs: <strong>' + analysis.betterThanDirect.length + '</strong> / ' + analysis.hubs.length + '</span>'
    + (analysis.bestHub ? '<span>Safest: <strong class="' + riskClass(analysis.bestHub.statistical) + '">' + analysis.bestHub.hub.code + ' SRI ' + analysis.bestHub.statistical + '</strong> (Δ' + (analysis.bestHub.delta >= 0 ? '+' : '') + analysis.bestHub.delta + ')</span>' : '')
    + '</div>';

  let html = '<table class="text-[10px] w-full"><thead class="text-[#666]"><tr>'
    + '<th>ROUTE</th><th>LEG 1</th><th>LEG 2</th><th>SRI</th><th>SAFE</th><th>LINEAR</th><th>Δ SRI</th><th>VERDICT</th></tr></thead><tbody>';

  html += '<tr class="border-b border-[#333] bg-[#0d1a0d]">'
    + '<td class="py-1 font-semibold">JFK → UK direct</td>'
    + '<td>—</td><td>—</td>'
    + '<td class="font-bold ' + riskClass(analysis.directSRI) + '">' + analysis.directSRI + '</td>'
    + '<td>' + analysis.directSafety + '</td><td>—</td>'
    + '<td>0</td><td class="risk-low">BASELINE</td></tr>';

  analysis.hubs.forEach((h, i) => {
    const rowCls = h.statistical < analysis.directSRI ? 'border-b border-[#222] bg-[#141a14]' : 'border-b border-[#222]';
    const highlight = i === 0 && h.statistical < analysis.directSRI ? ' ★' : '';
    html += '<tr class="' + rowCls + '">'
      + '<td class="py-1 max-w-[120px]" title="' + h.route + '">' + h.hub.flag + ' ' + h.hub.code + highlight + '</td>'
      + '<td class="' + riskClass(h.leg1.score) + '">' + h.leg1.score + '</td>'
      + '<td class="' + riskClass(h.leg2.score) + '">' + h.leg2.score + '</td>'
      + '<td class="font-bold ' + riskClass(h.statistical) + '">' + h.statistical + '</td>'
      + '<td>' + h.safetyIndex + '</td>'
      + '<td class="text-[#666]">' + h.linearSum + '</td>'
      + '<td class="' + (h.delta < 0 ? 'risk-low' : h.delta > 4 ? 'risk-high' : '') + '">' + (h.delta >= 0 ? '+' : '') + h.delta + '</td>'
      + '<td class="' + routeVerdictClass(h.verdict) + '">' + h.verdict + '</td></tr>';
  });
  html += '</tbody></table>';

  const best = analysis.bestHub;
  if (best) {
    html += '<div class="mt-3 panel p-2 text-[9px] text-[#888] space-y-1">'
      + '<div class="label mb-1">BEST HUB DETAIL — ' + best.hub.name.toUpperCase() + '</div>'
      + '<div>Corridor: ' + best.corridor + ' · Transit ~' + best.transitDays + 'd · EU duty ' + best.euDuty + '% · UK duty ' + best.ukDuty + '%</div>'
      + '<div>Leg 1 agency: ' + best.hub.agency + ' · Entry ' + best.hub.entryAir + '/' + (best.hub.entrySea || '—') + '</div>'
      + '<div>Leg 2: ' + best.leg2.exportSystem + ' → ' + best.leg2.ukEntry + ' · ' + best.leg2.notes + '</div>'
      + '<div class="text-[#666]">' + (window.JURISDICTIONS.triangularModel.euOriginAssumption || '') + '</div></div>';
  }

  body.innerHTML = html;
}

window.RouteBloomberg = {
  loadRouteData,
  analyzeRoutesForProduct,
  renderDetailReroute,
  renderRouteBloomberg,
  scanBestTriangularRoutes,
  showRerouteLegsError,
};

async function scanBestTriangularRoutes(weight, inputDims, limit) {
  await loadRouteData();
  const entries = Object.entries(PRODUCTS);
  const results = [];
  const chunk = 500;
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk);
    for (const [id, p] of slice) {
      const analysis = analyzeRoutesForProduct(p, weight, inputDims);
      if (analysis.bestHub && analysis.bestHub.statistical < analysis.directSRI) {
        results.push({ id, product: p, ...analysis, saving: analysis.directSRI - analysis.bestHub.statistical });
      }
    }
    await new Promise(r => setTimeout(r, 0));
  }
  results.sort((a, b) => b.saving - a.saving || a.bestHub.statistical - b.bestHub.statistical);
  return results.slice(0, limit || 20);
}