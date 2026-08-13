// Use relative API when deployed under the main site (protected).
// Falls back to the old external host only if needed for separate deployments.
const FEDEX_API_BASE = '';  // relative by default → calls /api/track etc under current origin
const HISTORY_KEY = 'pv-support-history';
const HISTORY_MAX = 30;

const $ = (sel) => document.querySelector(sel);

async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || /authentication required|www-authenticate/i.test(text)) {
      throw new Error('AUTH_HTML');
    }
    throw new Error('Carrier lookup is not available on this host yet.');
  }
  return res.json();
}

const API_SECTIONS = [
  ['Tracking Number Info', 'trackingNumberInfo'],
  ['Latest Status', 'latestStatusDetail'],
  ['Dates & Times', 'dateAndTimes'],
  ['Service', 'serviceDetail'],
  ['Service Commit Message', 'serviceCommitMessage'],
  ['Standard Transit Window', 'standardTransitTimeWindow'],
  ['Estimated Delivery Window', 'estimatedDeliveryTimeWindow'],
  ['Shipper', 'shipperInformation'],
  ['Recipient', 'recipientInformation'],
  ['Origin Location', 'originLocation'],
  ['Hold At Location', 'holdAtLocation'],
  ['Last Updated Destination', 'lastUpdatedDestinationAddress'],
  ['Package Details', 'packageDetails'],
  ['Shipment Details', 'shipmentDetails'],
  ['Delivery Details', 'deliveryDetails'],
  ['Custom Delivery Options', 'customDeliveryOptions'],
  ['Special Handlings', 'specialHandlings'],
  ['Additional Tracking Info', 'additionalTrackingInfo'],
  ['Available Notifications', 'availableNotifications'],
  ['Available Images', 'availableImages'],
  ['Return Detail', 'returnDetail'],
  ['Goods Classification', 'goodsClassificationCode'],
];

function normalizeTracking(raw) {
  return raw.replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

function formatTrackingDisplay(num) {
  return num.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function autoFormatTrackingInput(el) {
  el.addEventListener('input', () => {
    const cleaned = normalizeTracking(el.value);
    if (cleaned.length > 15) {
      el.value = formatTrackingDisplay(cleaned.slice(0,15));
    } else if (cleaned.length >= 4) {
      el.value = formatTrackingDisplay(cleaned);
    }
  });
}

function loadHistory() {
  try {
    const entries = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
}

function upsertHistory(entry) {
  const history = loadHistory().filter((h) => h.tracking !== entry.tracking);
  history.unshift({ ...entry, searchedAt: Date.now() });
  saveHistory(history);
  renderHistory();
}

function removeFromHistory(tracking) {
  saveHistory(loadHistory().filter((h) => h.tracking !== tracking));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function fmtRelative(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(new Date(ts).toISOString());
}

function renderHistory() {
  const container = $('#search-history');
  const history = loadHistory();
  if (!history.length) {
    container.classList.add('hidden');
    $('#history-list').innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  $('#history-list').innerHTML = history.map((h) => `
    <div class="history-item">
      <button type="button" class="history-track-btn" data-tracking="${escapeHtml(h.tracking)}">
        <span class="history-num">${escapeHtml(formatTrackingDisplay(h.tracking))}</span>
        ${h.status ? `<span class="history-status">${escapeHtml(h.status)}</span>` : ''}
        <span class="history-time">${escapeHtml(fmtRelative(h.searchedAt))}</span>
      </button>
      <button type="button" class="history-remove" data-tracking="${escapeHtml(h.tracking)}" aria-label="Remove from history">×</button>
    </div>
  `).join('');
}

function apiUrl(path) {
  // Relative calls (preferred when protected under primaryvowels.com).
  // We use clean /api/... paths — rewrites in vercel.json map them to support/api.
  if (!FEDEX_API_BASE) {
    return path;   // e.g. /api/track  (rewritten internally)
  }
  const base = FEDEX_API_BASE.replace(/\/$/, '');
  return `${base}${path}`;
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

function labelize(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function formatPrimitive(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return fmtDate(value);
  return String(value);
}

function renderValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return '<span class="detail-value muted">—</span>';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="detail-value muted">Empty</span>';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `<span class="detail-value">${escapeHtml(value.map(formatPrimitive).join(', '))}</span>`;
    }
    return `<div class="nested-list">${value.map((item, index) => `
      <div class="nested-block">
        <div class="nested-title">${index + 1}</div>
        ${renderValue(item, depth + 1)}
      </div>
    `).join('')}</div>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="detail-value muted">Empty</span>';
    return `<div class="detail-grid ${depth > 0 ? 'nested-grid' : ''}">
      ${entries.map(([key, val]) => {
        const primitive = val === null || val === undefined || typeof val !== 'object';
        const flat = primitive || (Array.isArray(val) && val.every((item) => item === null || typeof item !== 'object'));
        if (flat) {
          return `<div class="detail-item">
            <div class="detail-label">${escapeHtml(labelize(key))}</div>
            <div class="detail-value">${escapeHtml(formatPrimitive(val))}</div>
          </div>`;
        }
        return `<div class="detail-item detail-item-full">
          <div class="detail-label">${escapeHtml(labelize(key))}</div>
          ${renderValue(val, depth + 1)}
        </div>`;
      }).join('')}
    </div>`;
  }

  return `<span class="detail-value">${escapeHtml(formatPrimitive(value))}</span>`;
}

function renderSection(title, data) {
  if (isEmpty(data)) return '';
  return `
    <div class="panel api-section">
      <h2>${escapeHtml(title)}</h2>
      ${renderValue(data)}
    </div>
  `;
}

function statusClass(code, isDelayed) {
  if (code === 'DL') return 'delivered';
  if (isDelayed) return 'delayed';
  if (code === 'IT') return 'transit';
  return 'default';
}

function renderScanTimeline(scans) {
  if (!scans?.length) return '<div class="empty-state">No scan events</div>';
  return scans.map((s, i) => {
    const fields = Object.entries(s)
      .filter(([, v]) => !isEmpty(v))
      .map(([k, v]) => {
        if (typeof v === 'object') {
          return `<div class="scan-field">
            <span class="scan-field-label">${escapeHtml(labelize(k))}</span>
            <div class="scan-field-nested">${renderValue(v, 1)}</div>
          </div>`;
        }
        return `<div class="scan-field">
          <span class="scan-field-label">${escapeHtml(labelize(k))}</span>
          <span class="scan-field-value">${escapeHtml(formatPrimitive(v))}</span>
        </div>`;
      }).join('');

    return `
      <div class="timeline-item ${i === 0 ? 'latest' : ''}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-date">${fmtDate(s.date)}</div>
          <div class="timeline-desc">${escapeHtml(s.eventDescription || s.description || 'Scan')}</div>
          <div class="scan-fields">${fields}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderResult(data) {
  $('#error-area').classList.add('hidden');
  $('#results').classList.remove('hidden');

  if (data.sandboxNotice) {
    showEnvBanner(data.sandboxNotice, 'sandbox');
  }

  const cls = statusClass(data.statusCode, data.isDelayed);
  $('#status-header').innerHTML = `
    <div class="status-header ${cls}">
      <div class="status-code">${escapeHtml(data.status)}</div>
      <div class="tracking-num">${escapeHtml(data.trackingNumber)} <button class="copy-btn" data-copy="${escapeHtml(data.trackingNumber)}" title="Copy tracking number" style="margin-left:8px;font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid #3b3b5c;background:transparent;color:#a78bfa;cursor:pointer;">Copy</button></div>
      ${data.statusCode ? `<div class="status-meta">Code: ${escapeHtml(data.statusCode)} · ${data.scanCount} scan events</div>` : ''}
      ${data.isDelayed ? '<span class="delay-tag">Delayed</span>' : ''}
    </div>
  `;

  // Wire copy buttons after render
  setTimeout(() => {
    document.querySelectorAll('#status-header .copy-btn').forEach(b => {
      b.onclick = (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(b.dataset.copy).then(() => {
          const orig = b.textContent;
          b.textContent = 'Copied!';
          setTimeout(() => b.textContent = orig, 1200);
        });
      };
    });
  }, 0);

  $('#scan-count').textContent = `(${data.scanCount} events)`;
  $('#timeline').innerHTML = renderScanTimeline(data.scanEvents);

  const sections = API_SECTIONS
    .map(([title, key]) => renderSection(title, data[key]))
    .filter(Boolean)
    .join('');

  $('#all-sections').innerHTML = sections + `
    <div class="panel api-section raw-section">
      <details>
        <summary style="cursor:pointer; color:var(--accent-2); font-weight:600;">Complete carrier response (raw JSON)</summary>
        <p class="section-hint">Unmodified JSON returned by FedEx Track API for this lookup. For advanced debugging.</p>
        <pre class="raw-json">${escapeHtml(JSON.stringify(data.raw, null, 2))}</pre>
      </details>
    </div>
  `;

  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showError(msg) {
  $('#results').classList.add('hidden');
  $('#error-area').textContent = msg;
  $('#error-area').classList.remove('hidden');
}

function showEnvBanner(notice, env) {
  const note = $('#setup-note');
  if (!notice) {
    note.classList.add('hidden');
    return;
  }
  note.classList.remove('hidden');
  note.innerHTML = `<strong>${env === 'sandbox' ? 'Sandbox mode' : 'Notice'}:</strong> ${escapeHtml(notice)}`;
}

async function checkApi() {
  const dot = $('#server-dot');
  const text = $('#server-status-text');
  try {
    const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(5000) });
    let data;
    try {
      data = await safeJson(res);
    } catch (e) {
      if (e.message === 'AUTH_HTML') {
        dot.className = 'server-dot offline';
        text.textContent = 'Sign-in required — reload and authenticate when prompted';
        return false;
      }
      throw e;
    }
    if (data.error && data.error.includes('Authentication')) {
      dot.className = 'server-dot offline';
      text.textContent = 'Sign-in required';
      return false;
    }
    if (res.ok && data.fedexApi) {
      dot.className = data.liveData ? 'server-dot online' : 'server-dot sandbox';
      text.textContent = data.liveData
        ? 'FedEx API ready (live data)'
        : 'FedEx API ready (sandbox — not real tracking data)';
      showEnvBanner(data.sandboxNotice, data.env);
      return true;
    }
    dot.className = 'server-dot offline';
    text.textContent = 'FedEx API reachable but credentials not set on server';
    showEnvBanner(null);
    return false;
  } catch (err) {
    dot.className = 'server-dot offline';
    if (err.message === 'AUTH_HTML' || (err.message || '').includes('Authentication')) {
      text.textContent = 'Sign-in required — authenticate when prompted';
    } else {
      text.textContent = FEDEX_API_BASE
        ? 'Cannot reach FedEx API server'
        : 'Tracker is live — carrier API is not connected on this host';
    }
    showEnvBanner(null);
    return false;
  }
}

async function runTrack(tracking) {
  const btn = $('#track-btn');
  btn.disabled = true;
  btn.textContent = 'Tracking…';

  try {
    const res = await fetch(apiUrl(`/api/track?trackingNumber=${tracking}`));
    let data;
    try {
      data = await safeJson(res);
    } catch (e) {
      if (e.message === 'AUTH_HTML') {
        showError('Sign-in required. Reload the page and authenticate when prompted.');
        return;
      }
      throw e;
    }

    if (data.error && data.error.includes('Authentication')) {
      showError('This tracker is protected. Authenticate when prompted, then try again.');
      return;
    }
    if (!res.ok) {
      upsertHistory({ tracking, status: 'Lookup failed', statusCode: '' });
      throw new Error(data.error || 'Lookup failed');
    }
    upsertHistory({
      tracking,
      status: data.status,
      statusCode: data.statusCode || '',
    });
    renderResult(data);
  } catch (err) {
    showError(err.message || 'Failed to get tracking data (check auth or server)');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Track';
  }
}

async function track(e) {
  e.preventDefault();
  const tracking = normalizeTracking($('#tracking').value);
  if (tracking.length < 12) {
    showError('Enter a valid 12–15 digit FedEx tracking number.');
    return;
  }
  await runTrack(tracking);
}

$('#track-form').addEventListener('submit', track);

$('#search-history').addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.history-remove');
  if (removeBtn) {
    removeFromHistory(removeBtn.dataset.tracking);
    return;
  }

  const trackBtn = e.target.closest('.history-track-btn');
  if (trackBtn) {
    const tracking = trackBtn.dataset.tracking;
    $('#tracking').value = formatTrackingDisplay(tracking);
    runTrack(tracking);
  }
});

$('#history-clear').addEventListener('click', clearHistory);

renderHistory();
checkApi();

const trackingInput = $('#tracking');
if (trackingInput) autoFormatTrackingInput(trackingInput);

// Demo buttons
document.querySelectorAll('.demo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const demo = btn.dataset.demo;
    if (trackingInput) trackingInput.value = formatTrackingDisplay(demo);
    runTrack(demo);
  });
});