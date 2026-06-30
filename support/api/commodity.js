const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function normHs(hs) {
  return String(hs || "").replace(/[ .]/g, "");
}

function fmtHs(code) {
  const n = normHs(code);
  if (n.length !== 10) return code;
  return `${n.slice(0, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8, 10)}`;
}

function parseDuty(included) {
  for (const inc of included || []) {
    if (inc.type !== "import_trade_summary") continue;
    const raw = inc.attributes?.basic_third_country_duty || "";
    const m = String(raw).match(/([\d.]+)/);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

export default async function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const code = normHs(req.query?.code);
  if (!/^\d{10}$/.test(code)) {
    return res.status(400).json({ error: "Provide a 10-digit UK commodity code (e.g. 6203425900)" });
  }

  try {
    const url = `https://www.trade-tariff.service.gov.uk/api/v2/commodities/${code}`;
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? "Code not found in UK Trade Tariff" : "UK Trade Tariff API error",
      });
    }

    const data = await upstream.json();
    const attrs = data.data?.attributes || {};
    const chapter = parseInt(code.slice(0, 2), 10);
    const heading = code.slice(0, 4);
    const duty = parseDuty(data.included);
    const name = attrs.formatted_description || attrs.description_plain || attrs.description || "Commodity";

    const product = {
      name,
      hs: fmtHs(code),
      chapter,
      heading,
      duty,
      weight: 24,
      net: 22,
      dims: [18, 18, 18],
      value: 800,
      used: false,
      condition: "New",
      scrutiny: 2,
      desc: `${name}, UK commodity code ${fmtHs(code)}, country of origin United States, new.`,
      packing: "Match carton dims and gross weight on your commercial invoice",
      qty: 1,
      uom: "NAR",
      gir: ["GIR 1"],
      conf: 0.88,
      flags: {},
      restrictions: [],
      marketUsdLb: 33,
      source: "uk-trade-tariff-api",
    };

    return res.status(200).json({ id: code, product });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Lookup failed" });
  }
}