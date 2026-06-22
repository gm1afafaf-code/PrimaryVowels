import { fedexConfigured, trackShipment } from "../lib/fedex.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!fedexConfigured()) {
    return res.status(500).json({
      error: "FedEx API not configured. Set FEDEX_API_KEY and FEDEX_API_SECRET.",
    });
  }

  const tracking = String(
    req.method === "GET" ? req.query.trackingNumber : req.body?.trackingNumber || ""
  ).replace(/\s/g, "");

  if (!tracking || !/^\d{12,15}$/.test(tracking)) {
    return res.status(400).json({ error: "Invalid tracking number (12–15 digits)" });
  }

  try {
    const result = await trackShipment(tracking);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Tracking lookup failed" });
  }
}