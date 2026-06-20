import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type InvestigationStatus =
  | "queued"
  | "checking"
  | "analyzing"
  | "calling"
  | "on-call"
  | "complete"
  | "followup"
  | "error";

export interface TranscriptEntry {
  role: "agent" | "fedex" | "system" | "finding";
  text: string;
  at: string;
}

export interface Finding {
  category: string;
  text: string;
  at: string;
}

export interface Investigation {
  id: string;
  trackingNumber: string;
  context?: string;
  callbackPhone?: string;
  status: InvestigationStatus;
  createdAt: string;
  lastUpdate: string;
  callSid?: string;
  transcript: TranscriptEntry[];
  findings: Finding[];
  followupAt?: string;
  followupReason?: string;
  error?: string;
  summary?: string;
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "investigations.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll(): Investigation[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveAll(items: Investigation[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

export function createInvestigation(
  trackingNumber: string,
  context?: string,
  callbackPhone?: string
): Investigation {
  const now = new Date().toISOString();
  const inv: Investigation = {
    id: `inv_${crypto.randomBytes(8).toString("hex")}`,
    trackingNumber,
    context,
    callbackPhone,
    status: "queued",
    createdAt: now,
    lastUpdate: now,
    transcript: [],
    findings: [],
  };
  const all = loadAll();
  all.unshift(inv);
  saveAll(all);
  return inv;
}

export function getInvestigation(id: string): Investigation | undefined {
  return loadAll().find((i) => i.id === id);
}

export function listInvestigations(): Investigation[] {
  return loadAll();
}

export function updateInvestigation(
  id: string,
  patch: Partial<Investigation>
): Investigation | undefined {
  const all = loadAll();
  const idx = all.findIndex((i) => i.id === id);
  if (idx < 0) return undefined;
  all[idx] = { ...all[idx], ...patch, lastUpdate: new Date().toISOString() };
  saveAll(all);
  return all[idx];
}

export function addTranscript(
  id: string,
  role: TranscriptEntry["role"],
  text: string
) {
  const inv = getInvestigation(id);
  if (!inv) return;
  inv.transcript.push({ role, text, at: new Date().toISOString() });
  updateInvestigation(id, { transcript: inv.transcript });
}

export function addFinding(id: string, category: string, text: string) {
  const inv = getInvestigation(id);
  if (!inv) return;
  const finding: Finding = { category, text, at: new Date().toISOString() };
  inv.findings.push(finding);
  inv.transcript.push({ role: "finding", text: `[${category}] ${text}`, at: finding.at });
  updateInvestigation(id, { findings: inv.findings, transcript: inv.transcript });
}

export function getDueFollowups(): Investigation[] {
  const now = Date.now();
  return loadAll().filter(
    (i) =>
      i.status === "followup" &&
      i.followupAt &&
      new Date(i.followupAt).getTime() <= now
  );
}