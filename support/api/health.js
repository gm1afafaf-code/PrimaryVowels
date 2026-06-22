import { fedexConfigured } from "../lib/fedex.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();

  res.status(200).json({
    status: "ok",
    fedexApi: fedexConfigured(),
    env: process.env.FEDEX_ENV || "sandbox",
    timestamp: new Date().toISOString(),
  });
}