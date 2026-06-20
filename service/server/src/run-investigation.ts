import { trackShipment, fedexConfigured } from "./fedex-api";
import { extractFindings, needsFollowup, analyzeWithGrok } from "./analyzer";
import {
  addFinding,
  addTranscript,
  getDueFollowups,
  getInvestigation,
  updateInvestigation,
} from "./investigations";
import {
  notifyFinding,
  notifyFollowupScheduled,
  notifyInvestigationComplete,
  notifyInvestigationStarted,
} from "./notify";

const FOLLOWUP_HOURS = Number(process.env.FOLLOWUP_HOURS || "24");

const followupTimers = new Map<string, NodeJS.Timeout>();

function log(id: string, msg: string) {
  console.log(`[${id}] ${msg}`);
}

export function scheduleApiFollowup(investigationId: string, hours: number) {
  if (followupTimers.has(investigationId)) {
    clearTimeout(followupTimers.get(investigationId)!);
  }
  const timer = setTimeout(() => runApiInvestigation(investigationId), hours * 3_600_000);
  followupTimers.set(investigationId, timer);
  log(investigationId, `API re-check scheduled in ${hours}h`);
}

export async function runApiInvestigation(investigationId: string): Promise<void> {
  const inv = getInvestigation(investigationId);
  if (!inv) return;

  if (!fedexConfigured()) {
    updateInvestigation(investigationId, {
      status: "error",
      error: "FedEx API not configured. Set FEDEX_API_KEY and FEDEX_API_SECRET.",
    });
    return;
  }

  try {
    updateInvestigation(investigationId, { status: "checking" });
    addTranscript(investigationId, "system", `Querying FedEx Track API for ${inv.trackingNumber}…`);

    if (inv.callbackPhone && inv.status === "queued") {
      notifyInvestigationStarted(inv.callbackPhone, inv.trackingNumber);
    }

    const summary = await trackShipment(inv.trackingNumber);
    log(investigationId, `FedEx status: ${summary.status}`);

    const structured = extractFindings(summary);
    for (const f of structured) {
      addFinding(investigationId, f.category, f.text);
      addTranscript(investigationId, "finding", `[${f.category}] ${f.text}`);
      if (inv.callbackPhone) {
        notifyFinding(inv.callbackPhone, inv.trackingNumber, f.category, f.text);
      }
    }

    updateInvestigation(investigationId, { status: "analyzing" });
    addTranscript(investigationId, "system", "Grok analyzing shipment data…");

    const analysis = await analyzeWithGrok(summary, inv.context || "", inv.trackingNumber);
    addFinding(investigationId, "action_item", analysis);
    addTranscript(investigationId, "agent", analysis);
    updateInvestigation(investigationId, { summary: analysis });

    if (inv.callbackPhone) {
      notifyFinding(inv.callbackPhone, inv.trackingNumber, "action_item", analysis);
    }

    const followup = needsFollowup(summary, inv.context);
    if (followup.needed) {
      const followupAt = new Date(Date.now() + FOLLOWUP_HOURS * 3_600_000).toISOString();
      updateInvestigation(investigationId, {
        status: "followup",
        followupAt,
        followupReason: followup.reason,
      });
      addTranscript(investigationId, "system", `Monitoring scheduled — re-check in ${FOLLOWUP_HOURS}h: ${followup.reason}`);
      scheduleApiFollowup(investigationId, FOLLOWUP_HOURS);
      if (inv.callbackPhone) {
        notifyFollowupScheduled(inv.callbackPhone, inv.trackingNumber, followup.reason!, FOLLOWUP_HOURS);
      }
    } else {
      updateInvestigation(investigationId, { status: "complete" });
      addTranscript(investigationId, "system", "Investigation complete.");
      if (inv.callbackPhone) {
        const final = getInvestigation(investigationId)!;
        notifyInvestigationComplete(inv.callbackPhone, inv.trackingNumber, final.findings, "complete");
      }
    }
  } catch (err: any) {
    log(investigationId, `Error: ${err.message}`);
    updateInvestigation(investigationId, { status: "error", error: err.message });
    addTranscript(investigationId, "system", `Error: ${err.message}`);
  }
}

export function processDueApiFollowups() {
  for (const inv of getDueFollowups()) {
    runApiInvestigation(inv.id);
  }
}