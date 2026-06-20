const FEDEX_API_KEY = process.env.FEDEX_API_KEY || "";
const FEDEX_API_SECRET = process.env.FEDEX_API_SECRET || "";
const FEDEX_ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER || "";
const FEDEX_ENV = process.env.FEDEX_ENV || "sandbox";

const API_BASE =
  process.env.FEDEX_API_BASE ||
  (FEDEX_ENV === "production"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com");

let cachedToken: { token: string; expiresAt: number } | null = null;

export function fedexConfigured(): boolean {
  return !!(FEDEX_API_KEY && FEDEX_API_SECRET);
}

export interface ScanEvent {
  date: string;
  description: string;
  location: string;
  delayStatus?: string;
  delayType?: string;
  delaySubtype?: string;
}

export interface ShipmentSummary {
  trackingNumber: string;
  status: string;
  statusCode: string;
  service?: string;
  lastScan?: ScanEvent;
  scans: ScanEvent[];
  estimatedDelivery?: string;
  actualDelivery?: string;
  isDelayed: boolean;
  delayReason?: string;
  daysSinceLastScan: number;
  raw?: unknown;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: FEDEX_API_KEY,
    client_secret: FEDEX_API_SECRET,
  });

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.message || data.error_description || "FedEx auth failed");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

function formatLocation(scan: any): string {
  const loc = scan?.scanLocation;
  if (!loc) return "Unknown";
  const parts = [loc.city, loc.stateOrProvinceCode, loc.countryName || loc.countryCode].filter(Boolean);
  return parts.join(", ") || "Unknown";
}

function parseTrackResult(trackingNumber: string, trackResult: any): ShipmentSummary {
  const latest = trackResult?.latestStatusDetail || {};
  const scans: ScanEvent[] = (trackResult?.scanEvents || []).map((s: any) => ({
    date: s.date || "",
    description: s.eventDescription || s.derivedStatus || s.eventType || "Scan",
    location: formatLocation(s),
    delayStatus: s.delayDetail?.status,
    delayType: s.delayDetail?.type,
    delaySubtype: s.delayDetail?.subType,
  }));

  const lastScan = scans[0];
  const lastScanDate = lastScan?.date ? new Date(lastScan.date) : null;
  const daysSinceLastScan = lastScanDate
    ? Math.floor((Date.now() - lastScanDate.getTime()) / 86_400_000)
    : 999;

  const delayedScan = scans.find((s) => s.delayStatus === "DELAYED");
  const eta = trackResult?.dateAndTimes?.find(
    (d: any) => d.type === "ESTIMATED_DELIVERY" || d.type === "ANTICIPATED_TENDER"
  );
  const delivered = trackResult?.dateAndTimes?.find((d: any) => d.type === "ACTUAL_DELIVERY");

  const isDelayed =
    latest.derivedCode === "DE" ||
    latest.code === "DE" ||
    !!delayedScan ||
    scans.some((s) => /exception|delay/i.test(s.description));

  let delayReason: string | undefined;
  if (delayedScan) {
    delayReason = [delayedScan.delayType, delayedScan.delaySubtype].filter(Boolean).join(" — ");
  } else if (/exception|delay/i.test(latest.description || "")) {
    delayReason = latest.description;
  }

  return {
    trackingNumber,
    status: latest.statusByLocale || latest.description || "Unknown",
    statusCode: latest.derivedCode || latest.code || "",
    service: trackResult?.serviceDetail?.description,
    lastScan,
    scans: scans.slice(0, 10),
    estimatedDelivery: eta?.dateTime,
    actualDelivery: delivered?.dateTime,
    isDelayed,
    delayReason,
    daysSinceLastScan,
  };
}

export async function trackShipment(trackingNumber: string): Promise<ShipmentSummary> {
  const token = await getToken();

  const trackingInfo: Record<string, unknown> = {
    trackingNumberInfo: { trackingNumber },
  };
  if (FEDEX_ACCOUNT_NUMBER) {
    trackingInfo.shipperAccountNumber = FEDEX_ACCOUNT_NUMBER;
  }

  const res = await fetch(`${API_BASE}/track/v1/trackingnumbers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify({
      trackingInfo: [trackingInfo],
      includeDetailedScans: true,
    }),
  });

  const data = await res.json();

  if (!res.ok || data.errors?.length) {
    const msg = data.errors?.[0]?.message || `FedEx API error (${res.status})`;
    throw new Error(msg);
  }

  const result = data.output?.completeTrackResults?.[0];
  if (!result?.trackResults?.length) {
    throw new Error("No tracking data found for this number");
  }

  const trackResult = result.trackResults[0];
  if (trackResult.error) {
    throw new Error(trackResult.error.message || "Tracking lookup failed");
  }

  const summary = parseTrackResult(trackingNumber, trackResult);
  summary.raw = data;
  return summary;
}