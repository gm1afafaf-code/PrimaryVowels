const STORAGE_KEY = 'pv-fedex-investigations';
const API_URL_KEY = 'pv-agent-api-url';

const $ = (sel) => document.querySelector(sel);

function normalizeTracking(raw) {
  return raw.replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

function getApiBase() {
  const input = $('#api-url').value.trim();
  if (input) {
    localStorage.setItem(API_URL_KEY, input.replace(/\/$/, ''));
    return input.replace(/\/$/, '');
  }
  const stored = localStorage.getItem(API_URL_KEY);
  if (stored) return stored;
  if (window.PV_AGENT_URL) return window.PV_AGENT_URL.replace(/\/$/, '');
  return '';
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
}

function statusBadge(status) {
  const labels = {
    queued: 'Queued',
    checking: 'Querying FedEx API…',
    analyzing: 'Grok analyzing…',
    calling: 'Calling FedEx…',
    'on-call': 'On Call',
    complete: 'Complete',
    followup: 'Monitoring — re-check scheduled',
    error: 'Error',
  };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function renderStatus(inv) {
  $('#status-area').innerHTML = `
    ${statusBadge(inv.status)}
    <div style="font-family:monospace;font-size:1.1rem;margin-bottom:0.5rem">${inv.trackingNumber}</div>
    <div style="font-size:0.85rem;color:#7070a0">Started ${new Date(inv.createdAt).toLocaleString()}</div>
    ${inv.lastUpdate ? `<div style="font-size:0.85rem;color:#7070a0;margin-top:0.25rem">Updated ${new Date(inv.lastUpdate).toLocaleString()}</div>` : ''}
    ${inv.followupAt && inv.status === 'followup' ? `<div style="font-size:0.85rem;color:#eab308;margin-top:0.25rem">Re-check at ${new Date(inv.followupAt).toLocaleString()}</div>` : ''}
    ${inv.error ? `<div style="color:#ef4444;font-size:0.85rem;margin-top:0.5rem">${inv.error}</div>` : ''}
  `;

  const summaryEl = $('#summary-area');
  if (inv.summary) {
    summaryEl.innerHTML = `<strong style="color:#e8e8f0">Grok analysis:</strong><br>${escapeHtml(inv.summary)}`;
  } else {
    summaryEl.innerHTML = '';
  }
}

function renderTranscript(entries) {
  const el = $('#transcript');
  if (!entries || entries.length === 0) {
    el.innerHTML = '<div class="empty-state">Activity will appear here during investigation.</div>';
    return;
  }
  el.innerHTML = entries.map((e) => `
    <div class="transcript-entry ${e.role}">
      <div class="role">${e.role}</div>
      <div>${escapeHtml(e.text)}</div>
    </div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

function renderFindings(findings) {
  const el = $('#findings');
  if (!findings || findings.length === 0) {
    el.innerHTML = '<li class="empty-state" style="list-style:none">Status, location, delays, and Grok analysis appear here.</li>';
    return;
  }
  el.innerHTML = findings.map((f) => `
    <li>
      <div><span style="color:#7070a0;font-size:0.75rem;text-transform:uppercase">${escapeHtml(f.category)}</span><br>${escapeHtml(f.text)}</div>
      <div class="time">${new Date(f.at).toLocaleString()}</div>
    </li>
  `).join('');
}

function renderHistory(items, activeId) {
  const el = $('#history');
  if (items.length === 0) {
    el.innerHTML = '<div class="empty-state">No past investigations yet.</div>';
    return;
  }
  el.innerHTML = items.map((inv) => `
    <div class="investigation-card ${inv.id === activeId ? 'active' : ''}" data-id="${inv.id}">
      <div class="tracking">${inv.trackingNumber}</div>
      <div class="meta">${statusBadge(inv.status)} · ${new Date(inv.createdAt).toLocaleDateString()}</div>
    </div>
  `).join('');

  el.querySelectorAll('.investigation-card').forEach((card) => {
    card.addEventListener('click', () => selectInvestigation(card.dataset.id));
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let pollTimer = null;
let activeId = null;

async function checkServer() {
  const base = getApiBase();
  const dot = $('#server-dot');
  const text = $('#server-status-text');
  if (!base) {
    dot.className = 'server-dot offline';
    text.textContent = 'Agent server not configured — enter URL above';
    return false;
  }
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      dot.className = 'server-dot online';
      const extras = [];
      if (data.fedexApi) extras.push('FedEx API');
      if (data.grok) extras.push('Grok');
      if (data.sms) extras.push('SMS');
      text.textContent = `Server online — ${base}${extras.length ? ` (${extras.join(', ')})` : ''}`;
      return true;
    }
  } catch { /* offline */ }
  dot.className = 'server-dot offline';
  text.textContent = `Server offline — ${base}`;
  return false;
}

async function startInvestigation(e) {
  e.preventDefault();
  const tracking = normalizeTracking($('#tracking').value);
  if (tracking.length < 12) {
    alert('Please enter a valid FedEx tracking number (12+ digits).');
    return;
  }

  const base = getApiBase();
  if (!base) {
    alert('Please enter your agent server URL. Deploy service/server to Railway first.');
    return;
  }

  const btn = $('#start-btn');
  btn.disabled = true;
  btn.textContent = 'Investigating…';

  try {
    const res = await fetch(`${base}/api/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackingNumber: tracking,
        context: $('#context').value.trim(),
        callbackPhone: $('#callback').value.trim() || undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start investigation');

    activeId = data.id;
    const history = loadHistory();
    history.unshift(data);
    saveHistory(history);
    renderStatus(data);
    renderHistory(history, activeId);
    startPolling();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Investigate Package';
  }
}

async function pollInvestigation() {
  if (!activeId) return;
  const base = getApiBase();
  if (!base) return;

  try {
    const res = await fetch(`${base}/api/investigations/${activeId}`);
    if (!res.ok) return;
    const inv = await res.json();
    renderStatus(inv);
    renderTranscript(inv.transcript);
    renderFindings(inv.findings);

    const history = loadHistory();
    const idx = history.findIndex((h) => h.id === inv.id);
    if (idx >= 0) history[idx] = { ...history[idx], ...inv };
    saveHistory(history);
    renderHistory(history, activeId);

    if (['complete', 'error', 'followup'].includes(inv.status)) {
      stopPolling();
    }
  } catch { /* retry next tick */ }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollInvestigation, 1500);
  pollInvestigation();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function selectInvestigation(id) {
  activeId = id;
  const inv = loadHistory().find((h) => h.id === id);
  if (inv) {
    renderStatus(inv);
    renderTranscript(inv.transcript || []);
    renderFindings(inv.findings || []);
    renderHistory(loadHistory(), activeId);
    if (!['complete', 'error', 'followup'].includes(inv.status)) startPolling();
    else stopPolling();
  }
}

function init() {
  const savedUrl = localStorage.getItem(API_URL_KEY) || window.PV_AGENT_URL || '';
  if (savedUrl) $('#api-url').value = savedUrl;

  $('#investigate-form').addEventListener('submit', startInvestigation);
  $('#api-url').addEventListener('change', checkServer);

  const history = loadHistory();
  renderHistory(history, null);
  if (history.length > 0) selectInvestigation(history[0].id);

  checkServer();
  setInterval(checkServer, 30000);
}

init();