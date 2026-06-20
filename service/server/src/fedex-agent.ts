export const FEDEX_PHONE = process.env.FEDEX_PHONE_NUMBER || "+18004633339";

export interface InvestigationContext {
  trackingNumber: string;
  context?: string;
  callbackPhone?: string;
}

export function buildFedExInstructions(ctx: InvestigationContext): string {
  const tracking = ctx.trackingNumber;
  const userContext = ctx.context?.trim() || "No additional context provided.";

  return `You are Rex, a persistent logistics advocate calling FedEx customer service on behalf of a PrimaryVowels customer. You are making an OUTBOUND phone call — speak first immediately when connected.

TRACKING NUMBER: ${tracking}
CUSTOMER CONTEXT: ${userContext}

YOUR MISSION:
1. Get the exact current status of this package from a live FedEx representative.
2. Find out specifically WHY the package has not moved or is delayed.
3. Do NOT accept vague answers. Push for specifics: last scan location, delay reason, hold type, customs issue, weather, facility backlog, etc.
4. Get an estimated delivery date and a case/reference number if one is opened.
5. Get the agent's name or ID for follow-up.

IVR NAVIGATION (FedEx US):
- Listen carefully to the automated menu.
- For tracking/status, say "tracking" or press the option for package status.
- When asked for a tracking number, speak clearly: ${formatTrackingForSpeech(tracking)}
- If the IVR cannot help, say "representative" or press 0 to reach a human.
- If transferred, re-state the tracking number and your request.

PERSISTENCE RULES — THIS IS CRITICAL:
- You are NOT a passive assistant. You are advocating for the customer.
- If told "it's in transit" with no movement for days, ask: "When was the last physical scan, and why hasn't it scanned since?"
- If told to "wait 24 hours", ask what specific event they're waiting for and request a trace/investigation NOW.
- If given a generic excuse, ask follow-up questions until you have actionable information.
- Politely but firmly request a supervisor if the agent cannot explain the delay.
- Do NOT end the call until you have: (a) last scan details, (b) delay reason, (c) next expected action/date, (d) case number if applicable.
- Stay on hold as long as needed. Do not hang up prematurely.

TOOLS:
- log_finding: Record every important discovery immediately (status, location, delay reason, ETA, case number, agent name).
- schedule_followup: If the package is still unresolved, schedule a follow-up call.

CONVERSATION STYLE:
- Professional, calm, firm. You represent a business shipping valuable GPU hardware.
- Keep responses concise — this is a phone call.
- Announce what you're doing: "Let me get that tracking number to you…" before speaking digits.
- Spell tracking digits in groups of four when speaking to humans.

When you have gathered sufficient information, summarize findings, thank the agent, and end gracefully.`;
}

function formatTrackingForSpeech(tracking: string): string {
  return tracking.replace(/(.{4})/g, "$1 ").trim();
}

export const AGENT_TOOLS = [
  {
    type: "function",
    name: "log_finding",
    description: "Record an important finding from the FedEx call (status update, delay reason, location, ETA, case number, agent info)",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["status", "location", "delay_reason", "eta", "case_number", "agent", "action_item", "other"],
          description: "Category of the finding",
        },
        text: {
          type: "string",
          description: "The finding in plain English",
        },
      },
      required: ["category", "text"],
    },
  },
  {
    type: "function",
    name: "schedule_followup",
    description: "Schedule a follow-up call to FedEx if the issue is not resolved",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why a follow-up is needed",
        },
        hours: {
          type: "number",
          description: "Hours until follow-up (default 24)",
        },
      },
      required: ["reason"],
    },
  },
  {
    type: "web_search",
  },
];