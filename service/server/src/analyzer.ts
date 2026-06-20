import { ShipmentSummary } from "./fedex-api";

const XAI_API_KEY = process.env.XAI_API_KEY || "";
const GROK_MODEL = process.env.GROK_MODEL || "grok-3-mini";

export interface ParsedFinding {
  category: string;
  text: string;
}

export function extractFindings(summary: ShipmentSummary): ParsedFinding[] {
  const findings: ParsedFinding[] = [];

  findings.push({
    category: "status",
    text: `Current status: ${summary.status} (${summary.statusCode})`,
  });

  if (summary.service) {
    findings.push({ category: "status", text: `Service: ${summary.service}` });
  }

  if (summary.lastScan) {
    findings.push({
      category: "location",
      text: `Last scan: ${summary.lastScan.description} at ${summary.lastScan.location} (${summary.lastScan.date})`,
    });
  }

  if (summary.daysSinceLastScan >= 2 && summary.statusCode !== "DL") {
    findings.push({
      category: "delay_reason",
      text: `No movement for ${summary.daysSinceLastScan} days since last scan`,
    });
  }

  if (summary.isDelayed && summary.delayReason) {
    findings.push({
      category: "delay_reason",
      text: summary.delayReason,
    });
  }

  if (summary.estimatedDelivery) {
    findings.push({
      category: "eta",
      text: `Estimated delivery: ${new Date(summary.estimatedDelivery).toLocaleString()}`,
    });
  }

  if (summary.actualDelivery) {
    findings.push({
      category: "eta",
      text: `Delivered: ${new Date(summary.actualDelivery).toLocaleString()}`,
    });
  }

  return findings;
}

export function needsFollowup(summary: ShipmentSummary, context?: string): { needed: boolean; reason?: string } {
  if (summary.statusCode === "DL") {
    return { needed: false };
  }

  if (summary.isDelayed || summary.daysSinceLastScan >= 2) {
    return {
      needed: true,
      reason: summary.delayReason || `No scans in ${summary.daysSinceLastScan} days — will re-check`,
    };
  }

  if (context && /stuck|hasn't moved|no scan|delay/i.test(context)) {
    return { needed: true, reason: "User reported issue — monitoring for changes" };
  }

  return { needed: false };
}

export async function analyzeWithGrok(
  summary: ShipmentSummary,
  context: string,
  trackingNumber: string
): Promise<string> {
  if (!XAI_API_KEY) {
    return buildFallbackAnalysis(summary, context);
  }

  const scanLog = summary.scans
    .map((s) => `${s.date}: ${s.description} — ${s.location}`)
    .join("\n");

  const prompt = `You are a logistics analyst for PrimaryVowels, a GPU hardware reseller. Analyze this FedEx shipment and explain clearly why it may or may not have moved. Be direct and actionable.

Tracking: ${trackingNumber}
Customer concern: ${context || "Package may be stuck"}
Current status: ${summary.status} (${summary.statusCode})
Days since last scan: ${summary.daysSinceLastScan}
Delayed: ${summary.isDelayed ? "Yes" : "No"}
${summary.delayReason ? `Delay reason: ${summary.delayReason}` : ""}
${summary.estimatedDelivery ? `ETA: ${summary.estimatedDelivery}` : ""}

Recent scans:
${scanLog || "No scan events"}

In 3-5 sentences: What's happening? Why hasn't it moved (if applicable)? What should the customer expect next?`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: "system", content: "You analyze FedEx shipment data. Be concise, factual, and helpful." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "Grok analysis failed");
    }

    return data.choices?.[0]?.message?.content?.trim() || buildFallbackAnalysis(summary, context);
  } catch {
    return buildFallbackAnalysis(summary, context);
  }
}

function buildFallbackAnalysis(summary: ShipmentSummary, context: string): string {
  if (summary.statusCode === "DL") {
    return "Package has been delivered. No further action needed.";
  }
  if (summary.daysSinceLastScan >= 3) {
    return `Package shows "${summary.status}" but hasn't scanned in ${summary.daysSinceLastScan} days. This often indicates a facility handoff gap or weather delay. ${summary.delayReason ? `FedEx cites: ${summary.delayReason}.` : "Monitor for next scan."}`;
  }
  if (summary.isDelayed) {
    return `Shipment is delayed. ${summary.delayReason || summary.status}. ${summary.estimatedDelivery ? `New ETA: ${new Date(summary.estimatedDelivery).toLocaleDateString()}.` : ""}`;
  }
  return `Package is ${summary.status.toLowerCase()} and tracking normally.${context ? ` Regarding your note ("${context}"): latest scan is from ${summary.daysSinceLastScan} day(s) ago.` : ""}`;
}