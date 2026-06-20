import "dotenv-flow/config";
import express from "express";
import ExpressWs from "express-ws";
import cors from "cors";
import Twilio from "twilio";
import WebSocket from "ws";
import {
  AGENT_TOOLS,
  FEDEX_PHONE,
  buildFedExInstructions,
} from "./fedex-agent";
import {
  addFinding,
  addTranscript,
  createInvestigation,
  getInvestigation,
  listInvestigations,
  updateInvestigation,
} from "./investigations";
import { resolveHostname } from "./config";
import { fedexConfigured, trackShipment } from "./fedex-api";
import { extractFindings, analyzeWithGrok } from "./analyzer";
import {
  notifyFinding,
  notifyFollowupScheduled,
  notifyInvestigationComplete,
  notifyInvestigationStarted,
  smsAvailable,
} from "./notify";
import { processDueApiFollowups, runApiInvestigation } from "./run-investigation";

const { app } = ExpressWs(express());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const XAI_API_KEY = process.env.XAI_API_KEY || "";
const API_URL = process.env.API_URL || "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
const HOSTNAME = resolveHostname();
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || "";
const FOLLOWUP_HOURS = Number(process.env.FOLLOWUP_HOURS || "24");
const MAX_CALL_MS = Number(process.env.MAX_CALL_MINUTES || "20") * 60 * 1000;

const twilioClient =
  TWILIO_SID && TWILIO_TOKEN ? Twilio(TWILIO_SID, TWILIO_TOKEN) : null;

// Active call sessions keyed by investigation ID
const activeSessions = new Map<string, { ws: WebSocket; callSid: string }>();

function log(id: string, msg: string) {
  console.log(`[${id}] ${msg}`);
}

// ========================================
// REST API
// ========================================

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    hostname: HOSTNAME || null,
    fedexApi: fedexConfigured(),
    grok: !!XAI_API_KEY,
    telephony: !!(twilioClient && HOSTNAME),
    sms: smsAvailable(),
    mode: "api",
  });
});

app.get("/api/investigations", (_req, res) => {
  res.json(listInvestigations());
});

app.get("/api/investigations/:id", (req, res) => {
  const inv = getInvestigation(req.params.id);
  if (!inv) return res.status(404).json({ error: "Not found" });
  res.json(inv);
});

app.post("/api/investigate", async (req, res) => {
  const { trackingNumber, context, callbackPhone } = req.body;

  if (!trackingNumber || !/^\d{12,15}$/.test(String(trackingNumber).replace(/\s/g, ""))) {
    return res.status(400).json({ error: "Invalid tracking number (12–15 digits)" });
  }
  if (!fedexConfigured()) {
    return res.status(500).json({
      error: "FedEx API not configured. Set FEDEX_API_KEY and FEDEX_API_SECRET.",
    });
  }

  const tracking = String(trackingNumber).replace(/\s/g, "");
  const inv = createInvestigation(tracking, context, callbackPhone);

  res.json(getInvestigation(inv.id));
  runApiInvestigation(inv.id).catch((err) => {
    log(inv.id, `Investigation failed: ${err.message}`);
  });
});

app.post("/api/track", async (req, res) => {
  const tracking = String(req.body.trackingNumber || "").replace(/\s/g, "");
  if (!tracking || !/^\d{12,15}$/.test(tracking)) {
    return res.status(400).json({ error: "Invalid tracking number" });
  }
  if (!fedexConfigured()) {
    return res.status(500).json({ error: "FedEx API not configured" });
  }
  try {
    const summary = await trackShipment(tracking);
    const findings = extractFindings(summary);
    const analysis = await analyzeWithGrok(summary, req.body.context || "", tracking);
    res.json({ summary, findings, analysis });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/preview", (req, res) => {
  const tracking = String(req.body.trackingNumber || "794612345678901").replace(/\s/g, "");
  const context = req.body.context || "";
  res.json({
    instructions: buildFedExInstructions({ trackingNumber: tracking, context }),
    trackingNumber: tracking,
    fedexPhone: FEDEX_PHONE,
  });
});

app.post("/session", async (_req, res) => {
  if (!XAI_API_KEY) return res.status(500).json({ error: "XAI_API_KEY not configured" });
  try {
    const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expires_after: { seconds: 300 } }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// Twilio Webhooks
// ========================================

app.post("/outbound-twiml", (req, res) => {
  const investigationId = (req.query.investigationId as string) || "";
  const hostname = HOSTNAME.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const streamUrl = `wss://${hostname}/outbound-stream/${investigationId}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

app.post("/call-status", (req, res) => {
  const callSid = req.body.CallSid;
  const status = req.body.CallStatus;
  console.log(`[call-status] ${callSid} → ${status}`);

  const inv = listInvestigations().find((i) => i.callSid === callSid);
  if (inv && ["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) {
    if (inv.status !== "followup" && inv.status !== "complete") {
      if (inv.findings.length > 0) {
        updateInvestigation(inv.id, { status: "complete" });
        addTranscript(inv.id, "system", `Call ended (${status}). Investigation complete.`);
        if (inv.callbackPhone) {
          const updated = getInvestigation(inv.id)!;
          notifyInvestigationComplete(inv.callbackPhone, inv.trackingNumber, updated.findings, "complete");
        }
      } else if (status === "failed" || status === "no-answer" || status === "busy") {
        const reason = `Call ${status} — will retry`;
        updateInvestigation(inv.id, {
          status: "followup",
          followupAt: new Date(Date.now() + FOLLOWUP_HOURS * 3600000).toISOString(),
          followupReason: reason,
        });
        addTranscript(inv.id, "system", `Call ${status}. Follow-up scheduled in ${FOLLOWUP_HOURS}h.`);
        scheduleFollowupCall(inv.id, FOLLOWUP_HOURS);
        if (inv.callbackPhone) {
          notifyFollowupScheduled(inv.callbackPhone, inv.trackingNumber, reason, FOLLOWUP_HOURS);
        }
      } else {
        updateInvestigation(inv.id, { status: "complete" });
        if (inv.callbackPhone) {
          notifyInvestigationComplete(inv.callbackPhone, inv.trackingNumber, inv.findings, status);
        }
      }
    }
  }
  res.sendStatus(200);
});

// ========================================
// Outbound Media Stream → Grok Voice
// ========================================

app.ws("/outbound-stream/:investigationId", (ws, req) => {
  const investigationId = req.params.investigationId;
  const inv = getInvestigation(investigationId);

  if (!inv) {
    ws.close();
    return;
  }

  let callSid = "";
  let streamSid = "";
  let xaiWs: WebSocket | null = null;
  let sessionReady = false;
  let turnCount = 0;
  const callStart = Date.now();

  log(investigationId, "=== OUTBOUND STREAM OPENED ===");
  updateInvestigation(investigationId, { status: "on-call" });
  addTranscript(investigationId, "system", "Connected to FedEx line. Agent speaking…");

  function connectXAI() {
    xaiWs = new WebSocket(API_URL, {
      headers: { Authorization: `Bearer ${XAI_API_KEY}` },
    });

    xaiWs.on("open", () => {
      log(investigationId, "xAI WebSocket open");
      if (callSid) activeSessions.set(investigationId, { ws: xaiWs!, callSid });
      const sessionConfig = {
        type: "session.update",
        session: {
          instructions: buildFedExInstructions({
            trackingNumber: inv!.trackingNumber,
            context: inv!.context,
            callbackPhone: inv!.callbackPhone,
          }),
          voice: "rex",
          reasoning: { effort: "high" },
          audio: {
            input: { format: { type: "audio/pcmu" } },
            output: { format: { type: "audio/pcmu" } },
          },
          turn_detection: {
            type: "server_vad",
            silence_duration_ms: 1200,
            idle_timeout_ms: 8000,
          },
          tools: AGENT_TOOLS,
        },
      };
      xaiWs!.send(JSON.stringify(sessionConfig));
    });

    xaiWs.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "session.updated") {
          sessionReady = true;
          xaiWs!.send(JSON.stringify({ type: "response.create" }));
          log(investigationId, "Agent speaking first (outbound)");
        } else if (message.type === "response.created") {
          turnCount++;
        } else if (message.type === "response.output_audio.delta" && message.delta) {
          ws.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: message.delta },
            })
          );
        } else if (message.type === "response.output_audio_transcript.delta" && message.delta) {
          addTranscript(investigationId, "agent", message.delta);
        } else if (message.type === "conversation.item.input_audio_transcription.completed" && message.transcript) {
          addTranscript(investigationId, "fedex", message.transcript);
        } else if (message.type === "response.output_item.done" && message.item?.type === "function_call") {
          handleToolCall(investigationId, message.item);
        } else if (message.type === "response.done") {
          if (Date.now() - callStart > MAX_CALL_MS) {
            log(investigationId, "Max call duration reached, ending");
            endCall();
          }
        } else if (message.type === "error") {
          log(investigationId, `xAI error: ${message.error?.message || JSON.stringify(message)}`);
        }
      } catch (e) {
        /* ignore parse errors */
      }
    });

    xaiWs.on("close", () => log(investigationId, "xAI WebSocket closed"));
    xaiWs.on("error", (err) => log(investigationId, `xAI error: ${err.message}`));
  }

  function endCall() {
    if (xaiWs) xaiWs.close();
    ws.close();
    const current = getInvestigation(investigationId);
    if (current && current.status === "on-call") {
      updateInvestigation(investigationId, { status: "complete" });
      addTranscript(investigationId, "system", "Call ended.");
      if (current.callbackPhone) {
        const final = getInvestigation(investigationId)!;
        notifyInvestigationComplete(current.callbackPhone, current.trackingNumber, final.findings, "complete");
      }
    }
  }

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === "start") {
        callSid = msg.start.callSid;
        streamSid = msg.start.streamSid;
        updateInvestigation(investigationId, { callSid });
        connectXAI();
        if (xaiWs) activeSessions.set(investigationId, { ws: xaiWs, callSid });
      } else if (msg.event === "media" && msg.media?.track === "inbound") {
        if (xaiWs && sessionReady && xaiWs.readyState === WebSocket.OPEN) {
          xaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: msg.media.payload,
            })
          );
        }
      } else if (msg.event === "stop") {
        log(investigationId, "Twilio stream stopped");
        endCall();
      }
    } catch { /* ignore */ }
  });

  ws.on("close", () => {
    log(investigationId, "Twilio WebSocket closed");
    if (xaiWs) xaiWs.close();
    activeSessions.delete(investigationId);
  });
});

// ========================================
// Tool Handlers
// ========================================

async function handleToolCall(
  investigationId: string,
  item: { name: string; call_id: string; arguments?: string }
) {
  const inv = getInvestigation(investigationId);
  if (!inv) return;

  let args: Record<string, any> = {};
  try {
    args = JSON.parse(item.arguments || "{}");
  } catch { /* empty */ }

  log(investigationId, `TOOL ${item.name}(${JSON.stringify(args)})`);

  let result: string;

  switch (item.name) {
    case "log_finding": {
      const category = args.category || "other";
      const text = args.text || "";
      addFinding(investigationId, category, text);
      if (inv.callbackPhone) {
        notifyFinding(inv.callbackPhone, inv.trackingNumber, category, text);
      }
      result = JSON.stringify({ logged: true });
      break;
    }
    case "schedule_followup": {
      const hours = args.hours || FOLLOWUP_HOURS;
      const followupAt = new Date(Date.now() + hours * 3600000).toISOString();
      updateInvestigation(investigationId, {
        status: "followup",
        followupAt,
        followupReason: args.reason,
      });
      addTranscript(investigationId, "system", `Follow-up scheduled in ${hours}h: ${args.reason}`);
      scheduleFollowupCall(investigationId, hours);
      if (inv.callbackPhone) {
        notifyFollowupScheduled(inv.callbackPhone, inv.trackingNumber, args.reason, hours);
      }
      result = JSON.stringify({ scheduled: followupAt });
      break;
    }
    default:
      result = JSON.stringify({ error: `Unknown tool: ${item.name}` });
  }

  // Find active xAI session and send result
  const session = activeSessions.get(investigationId);
  if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: item.call_id,
          output: result,
        },
      })
    );
    session.ws.send(JSON.stringify({ type: "response.create" }));
  }
}

// ========================================
// Follow-up Scheduler
// ========================================

const followupTimers = new Map<string, NodeJS.Timeout>();

function scheduleFollowupCall(investigationId: string, hours: number) {
  if (followupTimers.has(investigationId)) {
    clearTimeout(followupTimers.get(investigationId)!);
  }
  const ms = hours * 3600000;
  const timer = setTimeout(() => retryInvestigation(investigationId), ms);
  followupTimers.set(investigationId, timer);
  log(investigationId, `Follow-up timer set for ${hours}h`);
}

async function retryInvestigation(investigationId: string) {
  const inv = getInvestigation(investigationId);
  if (!inv || !twilioClient || !HOSTNAME || !TWILIO_FROM) return;

  log(investigationId, "=== FOLLOW-UP CALL ===");
  addTranscript(investigationId, "system", "Initiating follow-up call to FedEx…");
  updateInvestigation(investigationId, { status: "calling" });

  try {
    const twimlUrl = `${HOSTNAME.replace(/\/$/, "")}/outbound-twiml?investigationId=${inv.id}`;
    const call = await twilioClient.calls.create({
      to: FEDEX_PHONE,
      from: TWILIO_FROM,
      url: twimlUrl,
      statusCallback: `${HOSTNAME.replace(/\/$/, "")}/call-status`,
      statusCallbackEvent: ["completed", "failed"],
      statusCallbackMethod: "POST",
    });
    updateInvestigation(investigationId, { callSid: call.sid });
  } catch (err: any) {
    updateInvestigation(investigationId, { status: "error", error: err.message });
  }
}

// API re-checks for stale packages; phone retry if telephony configured
function processDueFollowups() {
  processDueApiFollowups();
}
setInterval(processDueFollowups, 3600000);
processDueFollowups();

// ========================================
// Start
// ========================================

const port = process.env.PORT || "3000";
app.listen(port, () => {
  console.log(`FedEx Agent Server running on http://localhost:${port}`);
  console.log(`Mode: API-first (FedEx Track API + Grok analysis)`);
  console.log(`FedEx API: ${fedexConfigured() ? "configured" : "MISSING FEDEX_API_KEY/SECRET"}`);
  console.log(`Grok: ${XAI_API_KEY ? "configured" : "optional — set XAI_API_KEY for analysis"}`);
  console.log(`SMS: ${smsAvailable() ? "enabled" : "disabled"}`);
  console.log(`Telephony: ${twilioClient && HOSTNAME ? "available (escalation)" : "disabled"}`);
});