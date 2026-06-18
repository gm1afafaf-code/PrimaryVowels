/* Route Bloomberg engine v6.1 — NY→EU→UK triangular customs risk analysis */
let JURISDICTIONS = null;
let EU_CET = null;
let currentRouteAnalysis = null;
let currentRouteProduct = null;

async function loadRouteData() {
  if (JURISDICTIONS && EU_CET) return;
  const [jRes, cRes] = await Promise.all([
    fetch('data/jurisdictions.json'),
    fetch('data/eu-cet-chapters.json'),
  ]);
  if (!jRes.ok) throw new Error('jurisdictions.json HTTP ' + jRes.status);
  if (!cRes.ok) throw new Error('eu-cet-chapters.json HTTP ' + cRes.status);
  JURISDICTIONS = await jRes.json();
  EU_CET = await cRes.json();
}

function getEuDutyRate(product) {
  const ch = String(product.chapter);
  if (product.euDuty != null) return product.euDuty;
  return EU_CET?.chapters?.[ch] ?? product.duty ?? 0;
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

function scoreEuToUk(product, hub) {
  const m = JURISDICTIONS.triangularModel;
  const e2u = hub.euToUk;
  const breakdown = {
    leg2Base: e2u.leg2Base,
    roo: e2u.rooPenalty,
    doubleDecl: m.doubleDeclarationPenalty,
    warehouse: m.warehousingPenalty,
    inventory: m.inventoryRisk,
    ukSps: 0,
    transit: Math.min(8, Math.round((e2u.ferryHours || 24) / 12)),
  };

  if (product.restrictions?.length) {
    breakdown.ukSps = 6;
    if (product.restrictions.some(r => r.type === 'SPS' || r.type === 'PHYTO')) breakdown.ukSps = 10;
    if (product.restrictions.some(r => r.type === 'EXCISE')) breakdown.ukSps += 4;
  }
  if (product.flags?.dualUse) breakdown.ukSps += 5;
  if ((product.conf || 0) < 0.85) breakdown.roo += 3;

  const risk = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.max(4, Math.min(96, Math.round(risk)));
  return {
    score,
    breakdown,
    notes: e2u.notes,
    ukEntry: e2u.ukEntry,
    exportSystem: e2u.exportSystem,
    corridor: hub.ukCorridor,
  };
}

function compositeTriangular(leg1, leg2, hub, product) {
  const m = JURISDICTIONS.triangularModel;
  const hubBonus = Math.abs(Math.min(0, hubChapterBonus(hub, product.chapter))) + Math.abs(Math.min(0, hubStrengthMatch(hub, product)));
  const combined = leg1.score + leg2.score - Math.round(hubBonus * 0.5);
  return Math.max(4, Math.min(96, Math.round(combined)));
}

function analyzeRoutesForProduct(product, inputWeight, inputDims) {
  if (!JURISDICTIONS) return null;

  const direct = scoreOption(product, inputWeight, inputDims);
  const directUk = {
    route: 'JFK → ' + (getFreightConfig().entry || 'LHR') + ' (direct UK)',
    leg1: null,
    leg2: null,
    combined: direct.score,
    delta: 0,
    verdict: 'BASELINE',
    hub: null,
    breakdown: direct.breakdown,
  };

  const hubs = JURISDICTIONS.euHubs.map(hub => {
    const leg1 = scoreUsToEu(product, inputWeight, inputDims, hub);
    const leg2 = scoreEuToUk(product, hub);
    const combined = compositeTriangular(leg1, leg2, hub, product);
    const delta = combined - direct.score;
    let verdict = 'NEUTRAL';
    if (delta <= -6) verdict = 'HUB ADVANTAGE';
    else if (delta <= -2) verdict = 'SLIGHT EDGE';
    else if (delta >= 10) verdict = 'AVOID HUB';
    else if (delta >= 5) verdict = 'DIRECT PREFERRED';

    return {
      hub,
      route: 'JFK → ' + hub.entryAir + ' (' + hub.code + ') → ' + leg2.ukEntry + ' (UK)',
      leg1,
      leg2,
      combined,
      delta,
      verdict,
      euDuty: leg1.euDuty,
      ukDuty: product.duty,
      corridor: hub.ukCorridor,
      transitDays: hub.transitDays,
    };
  });

  hubs.sort((a, b) => a.combined - b.combined || a.delta - b.delta);

  const betterThanDirect = hubs.filter(h => h.combined < direct.score);
  const bestHub = hubs[0] || null;

  return {
    direct: directUk,
    directScore: direct.score,
    hubs,
    betterThanDirect,
    bestHub,
    bestOverall: bestHub && bestHub.combined < direct.score ? bestHub : directUk,
    recommendation: buildRouteRecommendation(direct.score, bestHub, betterThanDirect),
  };
}

function buildRouteRecommendation(directScore, bestHub, betterHubs) {
  if (!bestHub) return 'Insufficient route data.';
  if (bestHub.combined < directScore - 5) {
    return 'Triangular routing via ' + bestHub.hub.name + ' (' + bestHub.hub.code + ') reduces composite clearance risk by '
      + Math.abs(bestHub.delta) + ' pts vs direct JFK→UK. First leg scores ' + bestHub.leg1.score
      + '; EU→UK leg ' + bestHub.leg2.score + '. Verify RoO documentation and UK duty on US origin.';
  }
  if (betterHubs.length > 0) {
    return betterHubs.length + ' EU hub(s) beat direct UK on composite score, but margin is modest (best: '
      + bestHub.hub.code + ' Δ' + bestHub.delta + '). Weigh logistics cost and transit (' + bestHub.transitDays + 'd) before routing.';
  }
  return 'Direct JFK→UK remains lowest composite risk (' + directScore + '). EU hub adds leg-2 post-Brexit customs exposure without sufficient first-leg savings for this classification.';
}

function routeVerdictClass(verdict) {
  if (verdict === 'HUB ADVANTAGE' || verdict === 'SLIGHT EDGE') return 'risk-low';
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
  leg2Base: 'EU→UK corridor base', roo: 'Rules of origin / US origin', doubleDecl: 'Double declaration',
  warehouse: 'EU warehousing', inventory: 'Inventory exposure', ukSps: 'UK SPS at GB border', transit: 'Transit time risk',
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
    opt.textContent = h.hub.code + star + '· ' + h.hub.name + ' (comb ' + h.combined + ')';
    sel.appendChild(opt);
  });
  sel.value = prev && analysis.hubs.some(h => h.hub.code === prev) ? prev : analysis.hubs[0]?.hub?.code;
}

function renderDetailReroute(analysis, product, hubCode) {
  if (!analysis?.hubs?.length) return;
  populateRerouteHubSelect(analysis, hubCode);
  const code = hubCode || document.getElementById('reroute-hub-select')?.value || analysis.bestHub?.hub?.code;
  const route = analysis.hubs.find(h => h.hub.code === code) || analysis.bestHub;
  if (!route) return;

  const leg1El = document.getElementById('reroute-leg1');
  const leg2El = document.getElementById('reroute-leg2');
  const combEl = document.getElementById('reroute-combined');
  if (leg1El) { leg1El.textContent = route.leg1.score; leg1El.className = 'text-2xl font-bold leading-tight ' + riskClass(route.leg1.score); }
  if (leg2El) { leg2El.textContent = route.leg2.score; leg2El.className = 'text-2xl font-bold leading-tight ' + riskClass(route.leg2.score); }
  if (combEl) { combEl.textContent = route.combined; combEl.className = 'text-2xl font-bold leading-tight ' + riskClass(route.combined); }

  const l1Label = document.getElementById('reroute-leg1-label');
  const l2Label = document.getElementById('reroute-leg2-label');
  if (l1Label) l1Label.textContent = route.hub.entryAir + ' · ' + route.hub.agency.split('·')[0].trim() + ' · EU duty ' + route.euDuty + '%';
  if (l2Label) l2Label.textContent = route.leg2.exportSystem + ' → ' + route.leg2.ukEntry;

  const ukEntry = document.getElementById('reroute-uk-entry');
  if (ukEntry) ukEntry.textContent = route.leg2.ukEntry || 'UK';

  const deltaEl = document.getElementById('reroute-delta');
  if (deltaEl) {
    const d = route.delta;
    deltaEl.textContent = (d >= 0 ? '+' : '') + d + ' vs direct';
    deltaEl.className = 'text-[8px] ' + (d < 0 ? 'risk-low' : d > 5 ? 'risk-high' : 'text-[#888]');
  }

  const cmp = document.getElementById('reroute-direct-compare');
  if (cmp) {
    const better = route.combined < analysis.directScore;
    cmp.innerHTML = '<div class="flex justify-between flex-wrap gap-2">'
      + '<span>Direct JFK→UK: <strong class="' + riskClass(analysis.directScore) + '">' + analysis.directScore + '</strong></span>'
      + '<span>Re-route via <strong>' + route.hub.name + '</strong>: <strong class="' + riskClass(route.combined) + '">' + route.combined + '</strong></span>'
      + '<span class="' + routeVerdictClass(route.verdict) + '">' + route.verdict + '</span></div>'
      + '<div class="text-[#666] mt-0.5">' + route.corridor + ' · ~' + route.transitDays + 'd transit · UK duty ' + route.ukDuty + '% (US origin)</div>';
  }

  const b1 = document.getElementById('reroute-leg1-breakdown');
  const b2 = document.getElementById('reroute-leg2-breakdown');
  if (b1) b1.innerHTML = breakdownRows(route.leg1.breakdown, LEG1_LABELS);
  if (b2) b2.innerHTML = breakdownRows(route.leg2.breakdown, LEG2_LABELS);
}

function renderRouteBloomberg(analysis, product) {
  const panel = document.getElementById('route-bloomberg');
  const body = document.getElementById('route-bloomberg-body');
  const summary = document.getElementById('route-bloomberg-summary');
  if (!panel || !body || !analysis) return;

  panel.classList.remove('hidden');
  summary.innerHTML = '<div class="text-[10px] leading-relaxed text-[#aaa]">' + analysis.recommendation + '</div>'
    + '<div class="mt-2 flex gap-4 text-xs flex-wrap">'
    + '<span>Direct UK: <strong class="' + riskClass(analysis.directScore) + '">' + analysis.directScore + '</strong></span>'
    + '<span>EU hubs beating direct: <strong>' + analysis.betterThanDirect.length + '</strong> / ' + analysis.hubs.length + '</span>'
    + (analysis.bestHub ? '<span>Best hub: <strong class="' + riskClass(analysis.bestHub.combined) + '">' + analysis.bestHub.hub.code + ' @ ' + analysis.bestHub.combined + '</strong> (Δ' + (analysis.bestHub.delta >= 0 ? '+' : '') + analysis.bestHub.delta + ')</span>' : '')
    + '</div>';

  let html = '<table class="text-[10px] w-full"><thead class="text-[#666]"><tr>'
    + '<th>ROUTE</th><th>LEG 1</th><th>LEG 2</th><th>COMBINED</th><th>Δ vs UK</th><th>VERDICT</th></tr></thead><tbody>';

  html += '<tr class="border-b border-[#333] bg-[#0d1a0d]">'
    + '<td class="py-1 font-semibold">JFK → UK direct</td>'
    + '<td>—</td><td>—</td>'
    + '<td class="font-bold ' + riskClass(analysis.directScore) + '">' + analysis.directScore + '</td>'
    + '<td>0</td><td class="risk-low">BASELINE</td></tr>';

  analysis.hubs.forEach((h, i) => {
    const rowCls = h.combined < analysis.directScore ? 'border-b border-[#222] bg-[#141a14]' : 'border-b border-[#222]';
    const highlight = i === 0 && h.combined < analysis.directScore ? ' ★' : '';
    html += '<tr class="' + rowCls + '">'
      + '<td class="py-1 max-w-[140px]" title="' + h.route + '">' + h.hub.flag + ' ' + h.hub.code + ' · ' + h.hub.name + highlight + '</td>'
      + '<td class="' + riskClass(h.leg1.score) + '">' + h.leg1.score + '</td>'
      + '<td class="' + riskClass(h.leg2.score) + '">' + h.leg2.score + '</td>'
      + '<td class="font-bold ' + riskClass(h.combined) + '">' + h.combined + '</td>'
      + '<td class="' + (h.delta < 0 ? 'risk-low' : h.delta > 5 ? 'risk-high' : '') + '">' + (h.delta >= 0 ? '+' : '') + h.delta + '</td>'
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
      + '<div class="text-[#666]">' + JURISDICTIONS.triangularModel.originPreserved + '</div></div>';
  }

  body.innerHTML = html;
}

async function scanBestTriangularRoutes(weight, inputDims, limit) {
  await loadRouteData();
  const entries = Object.entries(PRODUCTS);
  const results = [];
  const chunk = 500;
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk);
    for (const [id, p] of slice) {
      const analysis = analyzeRoutesForProduct(p, weight, inputDims);
      if (analysis.bestHub && analysis.bestHub.combined < analysis.directScore) {
        results.push({ id, product: p, ...analysis, saving: analysis.directScore - analysis.bestHub.combined });
      }
    }
    await new Promise(r => setTimeout(r, 0));
  }
  results.sort((a, b) => b.saving - a.saving || a.bestHub.combined - b.bestHub.combined);
  return results.slice(0, limit || 20);
}