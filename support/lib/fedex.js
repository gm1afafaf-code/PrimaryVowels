const FEDEX_API_KEY = process.env.FEDEX_API_KEY || "";
const FEDEX_API_SECRET = process.env.FEDEX_API_SECRET || "";
const FEDEX_ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER || "";
const FEDEX_ENV = process.env.FEDEX_ENV || "sandbox";

const API_BASE =
  process.env.FEDEX_API_BASE ||
  (FEDEX_ENV === "production"
    ? "https://apis.fedex.com"
    : "https://apis-sandbox.fedex.com");

let cachedToken = null;

export function fedexConfigured() {
  return !!(FEDEX_API_KEY && FEDEX_API_SECRET);
}

function formatAddress(addr) {
  if (!addr) return null;
  const parts = [
    ...(addr.streetLines || []),
    addr.city,
    addr.stateOrProvinceCode,
    addr.postalCode,
    addr.countryName || addr.countryCode,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function formatLocation(scan) {
  const loc = scan?.scanLocation;
  if (!loc) return "Unknown";
  const parts = [loc.city, loc.stateOrProvinceCode, loc.countryName || loc.countryCode].filter(Boolean);
  return parts.join(", ") || "Unknown";
}

function formatWeight(packageDetails) {
  const raw = packageDetails?.weightAndDimensions?.weight;
  if (!raw) return null;
  const weights = Array.isArray(raw) ? raw : [raw];
  const primary = weights.find((w) => w.unit === "LB" || w.units === "LB") || weights[0];
  if (!primary?.value) return null;
  const unit = primary.unit || primary.units || "";
  return unit ? `${primary.value} ${unit}` : String(primary.value);
}

function formatDimensions(packageDetails) {
  const raw = packageDetails?.weightAndDimensions?.dimensions;
  if (!raw) return null;
  const dims = Array.isArray(raw) ? raw : [raw];
  const primary = dims.find((d) => d.units === "IN") || dims[0];
  if (!primary?.length) return null;
  const { length, width, height, units } = primary;
  return `${length} × ${width} × ${height} ${units || ""}`.trim();
}

function parseScan(s) {
  return {
    date: s.date || "",
    eventType: s.eventType || "",
    eventDescription: s.eventDescription || "",
    exceptionCode: s.exceptionCode || null,
    exceptionDescription: s.exceptionDescription || null,
    scanLocation: s.scanLocation || null,
    locationId: s.locationId || null,
    locationType: s.locationType || null,
    derivedStatusCode: s.derivedStatusCode || "",
    derivedStatus: s.derivedStatus || "",
    delayDetail: s.delayDetail || null,
    ancillaryDetails: s.ancillaryDetails || null,
    description: s.eventDescription || s.derivedStatus || s.eventType || "Scan",
    status: s.derivedStatus || "",
    location: formatLocation(s),
    facility: s.locationType || "",
    delay: s.delayDetail
      ? {
          status: s.delayDetail.status,
          type: s.delayDetail.type,
          subtype: s.delayDetail.subType,
        }
      : null,
    exception: s.exceptionDescription || s.exceptionCode || null,
  };
}

export function parseTrackResult(trackingNumber, trackResult) {
  const latest = trackResult?.latestStatusDetail || {};
  const scans = (trackResult?.scanEvents || []).map(parseScan);

  const lastScan = scans[0];
  const lastScanDate = lastScan?.date ? new Date(lastScan.date) : null;
  const daysSinceLastScan = lastScanDate
    ? Math.floor((Date.now() - lastScanDate.getTime()) / 86_400_000)
    : null;

  const dates = trackResult?.dateAndTimes || [];
  const estimatedDelivery = dates.find((d) =>
    ["ESTIMATED_DELIVERY", "ANTICIPATED_TENDER"].includes(d.type)
  )?.dateTime;
  const actualDelivery = dates.find((d) => d.type === "ACTUAL_DELIVERY")?.dateTime;
  const shipped = dates.find((d) => d.type === "SHIP")?.dateTime;

  const delayedScan = scans.find((s) => s.delay?.status === "DELAYED");
  const isDelayed =
    latest.derivedCode === "DE" ||
    latest.code === "DE" ||
    !!delayedScan ||
    scans.some((s) => /exception|delay/i.test(s.description));

  let delayReason;
  if (delayedScan?.delay) {
    delayReason = [delayedScan.delay.type, delayedScan.delay.subtype].filter(Boolean).join(" — ");
  } else if (/exception|delay/i.test(latest.description || "")) {
    delayReason = latest.description;
  }

  return {
    trackingNumber,
    status: latest.statusByLocale || latest.description || "Unknown",
    statusCode: latest.derivedCode || latest.code || "",
    statusDescription: latest.description || "",
    service: trackResult?.serviceDetail?.description || trackResult?.serviceDetail?.type,
    shipper: formatAddress(trackResult?.shipperInformation?.address),
    recipient: formatAddress(trackResult?.recipientInformation?.address),
    weight: formatWeight(trackResult?.packageDetails),
    dimensions: formatDimensions(trackResult?.packageDetails),
    packaging: trackResult?.packageDetails?.packagingDescription?.description,
    shipped,
    estimatedDelivery,
    estimatedDeliveryWindow: trackResult?.estimatedDeliveryTimeWindow || null,
    standardTransitTimeWindow: trackResult?.standardTransitTimeWindow || null,
    actualDelivery,
    isDelayed,
    delayReason,
    daysSinceLastScan,
    lastScan,
    scans,
    scanCount: scans.length,
    deliveryAttempts: trackResult?.deliveryDetails?.deliveryAttempts,
    receivedBy: trackResult?.deliveryDetails?.receivedByName,

    trackingNumberInfo: trackResult?.trackingNumberInfo || null,
    additionalTrackingInfo: trackResult?.additionalTrackingInfo || null,
    shipperInformation: trackResult?.shipperInformation || null,
    recipientInformation: trackResult?.recipientInformation || null,
    latestStatusDetail: trackResult?.latestStatusDetail || null,
    dateAndTimes: trackResult?.dateAndTimes || [],
    availableImages: trackResult?.availableImages || [],
    specialHandlings: trackResult?.specialHandlings || [],
    packageDetails: trackResult?.packageDetails || null,
    shipmentDetails: trackResult?.shipmentDetails || null,
    scanEvents: scans,
    availableNotifications: trackResult?.availableNotifications || [],
    deliveryDetails: trackResult?.deliveryDetails || null,
    originLocation: trackResult?.originLocation || null,
    holdAtLocation: trackResult?.holdAtLocation || null,
    lastUpdatedDestinationAddress: trackResult?.lastUpdatedDestinationAddress || null,
    serviceCommitMessage: trackResult?.serviceCommitMessage || null,
    serviceDetail: trackResult?.serviceDetail || null,
    customDeliveryOptions: trackResult?.customDeliveryOptions || [],
    goodsClassificationCode: trackResult?.goodsClassificationCode || null,
    returnDetail: trackResult?.returnDetail || null,
    raw: trackResult,

    sandbox: FEDEX_ENV !== "production",
    sandboxNotice:
      FEDEX_ENV !== "production"
        ? "FedEx sandbox returns the same sample shipment for every tracking number. Switch FEDEX_ENV to production with production API credentials for real tracking data."
        : null,
  };
}

async function getToken() {
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

export async function trackShipment(trackingNumber) {
  const token = await getToken();

  const trackingInfo = {
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
    throw new Error(data.errors?.[0]?.message || `FedEx API error (${res.status})`);
  }

  const result = data.output?.completeTrackResults?.[0];
  if (!result?.trackResults?.length) {
    throw new Error("No tracking data found for this number");
  }

  const trackResult = result.trackResults[0];
  if (trackResult.error) {
    throw new Error(trackResult.error.message || "Tracking lookup failed");
  }

  return parseTrackResult(trackingNumber, trackResult);
}