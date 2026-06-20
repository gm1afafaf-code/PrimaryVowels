import Twilio from "twilio";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || "";
const SMS_ENABLED = process.env.SMS_ENABLED !== "false";

const client =
  SMS_ENABLED && TWILIO_SID && TWILIO_TOKEN
    ? Twilio(TWILIO_SID, TWILIO_TOKEN)
    : null;

const IMPORTANT_CATEGORIES = new Set([
  "status",
  "delay_reason",
  "eta",
  "case_number",
  "action_item",
]);

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!client || !TWILIO_FROM) return false;
  const phone = normalizePhone(to);
  if (!phone) return false;

  try {
    await client.messages.create({ to: phone, from: TWILIO_FROM, body });
    console.log(`[sms] Sent to ${phone.slice(0, -4)}****`);
    return true;
  } catch (err: any) {
    console.error(`[sms] Failed: ${err.message}`);
    return false;
  }
}

export function smsAvailable(): boolean {
  return !!(client && TWILIO_FROM);
}

export async function notifyInvestigationStarted(
  phone: string,
  trackingNumber: string
) {
  await sendSms(
    phone,
    `PrimaryVowels FedEx Agent: Investigation started for tracking ${trackingNumber}. We'll text you findings as they come in.`
  );
}

export async function notifyFinding(
  phone: string,
  trackingNumber: string,
  category: string,
  text: string
) {
  if (!IMPORTANT_CATEGORIES.has(category)) return;
  const label = category.replace(/_/g, " ").toUpperCase();
  await sendSms(phone, `FedEx update (${trackingNumber})\n${label}: ${text}`);
}

export async function notifyInvestigationComplete(
  phone: string,
  trackingNumber: string,
  findings: { category: string; text: string }[],
  status: string
) {
  const lines = findings
    .slice(-6)
    .map((f) => `• ${f.text}`)
    .join("\n");

  const body = lines
    ? `FedEx investigation ${status} — ${trackingNumber}\n\n${lines}\n\nView details at primaryvowels.com/service/`
    : `FedEx investigation ${status} — ${trackingNumber}. No findings recorded. View at primaryvowels.com/service/`;

  await sendSms(phone, body);
}

export async function notifyFollowupScheduled(
  phone: string,
  trackingNumber: string,
  reason: string,
  hours: number
) {
  await sendSms(
    phone,
    `FedEx follow-up scheduled for ${trackingNumber} in ${hours}h.\nReason: ${reason}`
  );
}