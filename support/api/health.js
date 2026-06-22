import { fedexConfigured } from "../lib/fedex.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();

  const env = process.env.FEDEX_ENV || "sandbox";
  res.status(200).json({
    status: "ok",
    fedexApi: fedexConfigured(),
    env,
    liveData: env === "production",
    sandboxNotice:
      env !== "production"
        ? "Sandbox mode: all tracking numbers return the same FedEx test shipment, not real package data."
        : null,
    timestamp: new Date().toISOString(),
  });
}