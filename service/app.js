const $ = (sel) => document.querySelector(sel);

function normalizeTracking(raw) {
  return raw.replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

function getApiBase() {
  if (window.PV_API_URL) return window.PV_API_URL.replace(/\/$/, '');
  return '';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusClass(code, isDelayed) {
  if (code === 'DL') return 'delivered';
  if (isDelayed) return 'delayed';
  if (code === 'IT') return 'transit';
  return 'default';
}

function renderResult(data) {
  $('#error-area').classList.add('hidden');
  $('#results').classList.remove('hidden');

  const cls = statusClass(data.statusCode, data.isDelayed);
  $('#status-header').innerHTML = `
    <div class="status-header ${cls}">
      <div class="status-code">${escapeHtml(data.status)}</div>
      <div class="tracking-num">${escapeHtml(data.trackingNumber)}</div>
      ${data.isDelayed ? '<span class="delay-tag">Delayed</span>' : ''}
    </div>
  `;

  const details = [
    ['Service', data.service],
    ['Estimated delivery', fmtDate(data.estimatedDelivery)],
    ['Delivered', fmtDate(data.actualDelivery)],
    ['Days since last scan', data.daysSinceLastScan ?? '—'],
    ['Delay reason', data.delayReason],
    ['Last scan', data.lastScan ? `${data.lastScan.description} — ${data.lastScan.location}` : null],
  ].filter(([, v]) => v);

  $('#details').innerHTML = details.map(([k, v]) => `
    <div class="detail-item">
      <div class="detail-label">${k}</div>
      <div class="detail-value">${escapeHtml(v)}</div>
    </div>
  `).join('');

  const info = [
    ['Shipper', data.shipper],
    ['Recipient', data.recipient],
    ['Weight', data.weight],
    ['Packaging', data.packaging],
    ['Shipped', fmtDate(data.shipped)],
    ['Delivery attempts', data.deliveryAttempts],
    ['Received by', data.receivedBy],
    ['Special handling', data.specialHandling?.join(', ')],
  ].filter(([, v]) => v);

  $('#shipment-info').innerHTML = info.length
    ? info.map(([k, v]) => `
        <div class="detail-item">
          <div class="detail-label">${k}</div>
          <div class="detail-value">${escapeHtml(v)}</div>
        </div>
      `).join('')
    : '<div class="empty-state">No additional shipment details</div>';

  $('#scan-count').textContent = `(${data.scanCount} events)`;

  $('#timeline').innerHTML = data.scans.length
    ? data.scans.map((s, i) => `
        <div class="timeline-item ${i === 0 ? 'latest' : ''}">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-date">${fmtDate(s.date)}</div>
            <div class="timeline-desc">${escapeHtml(s.description)}</div>
            <div class="timeline-loc">${escapeHtml(s.location)}${s.facility ? ` · ${escapeHtml(s.facility)}` : ''}</div>
            ${s.exception ? `<div class="timeline-exception">${escapeHtml(s.exception)}</div>` : ''}
            ${s.delay ? `<div class="timeline-delay">Delay: ${escapeHtml([s.delay.type, s.delay.subtype].filter(Boolean).join(' — '))}</div>` : ''}
          </div>
        </div>
      `).join('')
    : '<div class="empty-state">No scan events</div>';

  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showError(msg) {
  $('#results').classList.add('hidden');
  $('#error-area').textContent = msg;
  $('#error-area').classList.remove('hidden');
}

async function checkApi() {
  const base = getApiBase();
  const dot = $('#server-dot');
  const text = $('#server-status-text');
  if (!base) {
    dot.className = 'server-dot offline';
    text.textContent = 'API URL not set in config.js';
    return false;
  }
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (res.ok && data.fedexApi) {
      dot.className = 'server-dot online';
      text.textContent = `FedEx API ready (${data.env})`;
      return true;
    }
    dot.className = 'server-dot offline';
    text.textContent = data.fedexApi ? 'API reachable' : 'FedEx credentials not configured on server';
    return false;
  } catch {
    dot.className = 'server-dot offline';
    text.textContent = `Cannot reach API at ${base}`;
    return false;
  }
}

async function track(e) {
  e.preventDefault();
  const tracking = normalizeTracking($('#tracking').value);
  if (tracking.length < 12) {
    showError('Enter a valid 12–15 digit FedEx tracking number.');
    return;
  }

  const base = getApiBase();
  if (!base) {
    showError('Set PV_API_URL in service/config.js to your Vercel deployment URL.');
    return;
  }

  const btn = $('#track-btn');
  btn.disabled = true;
  btn.textContent = 'Tracking…';

  try {
    const res = await fetch(`${base}/api/track?trackingNumber=${tracking}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    renderResult(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Track';
  }
}

$('#track-form').addEventListener('submit', track);
checkApi();