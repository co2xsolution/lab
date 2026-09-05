/*********************************************************************
 * LabChem front end
 ********************************************************************/

let BOOT = { app: { org: 'Laboratory' }, permissions: [], roles: {}, deepLink: '' };

const S = {
  view: 'dashboard',
  chemicals: [], locations: [], requests: [], sds: [], usage: [], users: [], audit: [],
  dash: null,
  filter: { text: '', status: 'ALL', category: 'ALL' },
  reqFilter: 'ALL',
  usageFilter: { action: '', from: '', to: '', user: '' },
  selection: {},
  loaded: {}
};

/* ---------- plumbing ---------- */

/* ---------- session token ---------- */

const TOKEN_KEY = 'labchem.token';
let TOKEN = null;

function readToken() {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
function writeToken(t) {
  TOKEN = t;
  try { t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY); }
  catch (e) { /* storage blocked — the session lasts until this tab is closed */ }
}

/* ---------- transport: JSON over fetch to the Apps Script API ---------- */

/** Returns a human explanation if the app is not configured, or null if it is. */
function configProblem() {
  let stored = null;
  try { stored = window.localStorage.getItem('labchem.api'); } catch (e) { /* blocked */ }

  if (!stored && !window.LABCHEM_CONFIG) {
    return 'config.js did not load. It must sit next to index.html in the repository, ' +
      'and the name is case sensitive.';
  }
  const url = stored || (window.LABCHEM_CONFIG && window.LABCHEM_CONFIG.apiUrl) || '';
  if (!url || /PASTE_YOUR/.test(url)) {
    return 'config.js still holds the placeholder. Paste your Apps Script web app URL into apiUrl.';
  }
  if (!/^https:\/\//.test(url)) {
    return 'The address in config.js must start with https:// — it currently reads "' + url + '".';
  }
  if (/\/dev$/.test(url)) {
    return 'config.js points at the /dev URL, which only works while you are signed in as the ' +
      'script owner. Use the /exec URL from Deploy → Manage deployments.';
  }
  if (!/\/exec$/.test(url)) {
    return 'The address in config.js should end in /exec. Copy it from Deploy → Manage deployments.';
  }
  return null;
}

function endpoint() {
  let stored = null;
  try { stored = window.localStorage.getItem('labchem.api'); } catch (e) { /* blocked */ }
  return stored || (window.LABCHEM_CONFIG && window.LABCHEM_CONFIG.apiUrl) || '';
}

/** True when assets/styles.css actually arrived. */
function stylesLoaded() {
  const probe = document.createElement('span');
  probe.className = 'tag';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const ok = window.getComputedStyle(probe).borderStyle === 'solid';
  probe.parentNode.removeChild(probe);
  return ok;
}

/** A diagnostic panel that works even when the stylesheet is missing. */
function showFatal(heading, detail, steps) {
  const wrap = document.createElement('div');
  wrap.setAttribute('style',
    'position:fixed;inset:0;overflow:auto;z-index:99;background:#f2f5f4;' +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#10202b');
  wrap.innerHTML =
    '<div style="max-width:640px;margin:8vh auto;padding:28px;background:#fff;' +
    'border:1px solid #d6dfe0;border-left:6px solid #b26a00;border-radius:5px">' +
    '<h2 style="margin:0 0 8px;font-size:20px">' + esc(heading) + '</h2>' +
    '<p style="margin:0 0 16px;color:#5b6b74">' + esc(detail) + '</p>' +
    (steps ? '<ol style="margin:0;padding-left:20px;color:#10202b">' +
      steps.map(function (s) { return '<li style="margin-bottom:7px">' + s + '</li>'; }).join('') +
      '</ol>' : '') +
    '<p style="margin:18px 0 0;font-size:13px;color:#5b6b74">' +
    'Open your browser console (F12) for the underlying error.</p></div>';
  document.body.appendChild(wrap);
}

/**
 * Content-Type stays text/plain on purpose: it keeps the request "simple" so the
 * browser skips the CORS preflight, which Apps Script cannot answer.
 */
function send(fn, args, token) {
  const problem = configProblem();
  if (problem) return Promise.reject(new Error(problem));

  return fetch(endpoint(), {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fn, token: token || null, args: args || [] })
  }).then(function (res) {
    if (!res.ok) throw new Error('The server replied with status ' + res.status + '.');
    return res.text();
  }).then(function (text) {
    let payload;
    try { payload = JSON.parse(text); }
    catch (e) {
      throw new Error('The server sent a web page instead of data. That happens when the Apps Script ' +
        'deployment is not set to "Anyone", so Google returned its sign-in page.');
    }
    if (!payload.ok) throw new Error(payload.error || 'The server rejected that request.');
    return payload.data;
  }, function (netErr) {
    throw new Error('The browser could not reach the API. Check the address in config.js and that the ' +
      'deployment allows "Anyone". (' + (netErr && netErr.message ? netErr.message : netErr) + ')');
  });
}

/** Authenticated call: the session token travels in the body. */
function api(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  return send(fn, args, TOKEN).catch(function (err) {
    if (/session has ended|No signed-in session|Sign in to continue/i.test(err.message || '')) {
      writeToken(null);
      renderLogin('Your session has ended. Sign in again.');
    }
    throw err;
  });
}

/** Public call: sign in, register, forgotten password. */
function pub(fn) {
  const args = Array.prototype.slice.call(arguments, 1);
  return send(fn, args, null);
}

function can(perm) {
  return BOOT.permissions.indexOf('*') >= 0 || BOOT.permissions.indexOf(perm) >= 0;
}

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  if (!iso) return '—';
  const s = String(iso).substring(0, 10).split('-');
  if (s.length !== 3) return esc(iso);
  return Number(s[2]) + ' ' + MONTHS[Number(s[1]) - 1] + ' ' + s[0];
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return fmtDate(iso) + (String(iso).length > 10 ? ', ' + String(iso).substring(11, 16) : '');
}
function fmtQty(n) {
  const v = Number(n || 0);
  return (Math.round(v * 1000) / 1000).toLocaleString();
}
function today() { return new Date().toISOString().substring(0, 10); }

function toast(message, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(function () { el.remove(); }, bad ? 7000 : 4200);
}

function fail(err) { toast(err && err.message ? err.message : String(err), true); }

function closeLayer() { document.getElementById('layer').innerHTML = ''; }

function showModal(title, bodyHtml, footerHtml) {
  document.getElementById('layer').innerHTML =
    '<div class="veil" onclick="if(event.target===this)closeLayer()"><div class="modal" role="dialog" aria-modal="true">' +
    '<header><h3>' + esc(title) + '</h3><button class="x" onclick="closeLayer()" aria-label="Close">&times;</button></header>' +
    '<div class="body">' + bodyHtml + '</div>' +
    (footerHtml ? '<footer>' + footerHtml + '</footer>' : '') +
    '</div></div>';
}

function showDrawer(headerHtml, bodyHtml, footerHtml) {
  document.getElementById('layer').innerHTML =
    '<div class="veil" onclick="if(event.target===this)closeLayer()" style="justify-content:flex-end;padding:0">' +
    '<div class="drawer" role="dialog" aria-modal="true">' +
    '<header>' + headerHtml + '<button class="x" onclick="closeLayer()" aria-label="Close">&times;</button></header>' +
    '<div class="body">' + bodyHtml + '</div>' +
    (footerHtml ? '<footer>' + footerHtml + '</footer>' : '') +
    '</div></div>';
}

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setBusy(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; }
  else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
}

/* ---------- navigation ---------- */

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', perm: 'dashboard.view', title: 'Dashboard' },
  { id: 'inventory', label: 'Chemicals', perm: 'inventory.view', title: 'Chemical inventory' },
  { id: 'requests', label: 'Requests', perm: 'request.create|request.viewAll|request.viewOwn', title: 'Chemical requests' },
  { id: 'sds', label: 'Safety data sheets', perm: 'sds.view', title: 'Safety data sheets' },
  { id: 'usage', label: 'Usage history', perm: 'usage.viewOwn|usage.viewAll', title: 'Usage history' },
  { id: 'labels', label: 'QR labels', perm: 'qr.print', title: 'QR labels' },
  { id: 'people', label: 'People', perm: '*', title: 'People and roles' },
  { id: 'audit', label: 'Audit trail', perm: 'audit.view', title: 'Audit trail' },
  { id: 'settings', label: 'Settings', perm: '*', title: 'Settings' }
];

function visibleViews() {
  return VIEWS.filter(function (v) {
    return v.perm.split('|').some(function (p) { return can(p); });
  });
}

function renderNav() {
  const pending = S.dash && S.dash.totals ? S.dash.totals.pendingRequests : 0;
  const alerts = S.dash && S.dash.totals ? (S.dash.totals.expired + S.dash.totals.out) : 0;
  document.getElementById('nav').innerHTML = visibleViews().map(function (v) {
    let pill = '';
    if (v.id === 'requests' && pending && can('request.decide')) pill = '<span class="pill">' + pending + '</span>';
    if (v.id === 'inventory' && alerts) pill = '<span class="pill">' + alerts + '</span>';
    return '<button class="' + (S.view === v.id ? 'on' : '') + '" onclick="go(\'' + v.id + '\')">' +
      esc(v.label) + pill + '</button>';
  }).join('');
}

function go(view) {
  S.view = view;
  renderNav();
  const meta = VIEWS.filter(function (v) { return v.id === view; })[0] || { title: view };
  document.getElementById('viewTitle').textContent = meta.title;
  document.getElementById('viewSub').textContent = '';
  document.getElementById('topActions').innerHTML = '';
  document.getElementById('content').innerHTML = '<div class="loading">Loading…</div>';
  ({
    dashboard: viewDashboard, inventory: viewInventory, requests: viewRequests,
    sds: viewSds, usage: viewUsage, labels: viewLabels, people: viewPeople,
    audit: viewAudit, settings: viewSettings
  })[view]();
}

function setSub(text) { document.getElementById('viewSub').textContent = text; }
function setActions(html) { document.getElementById('topActions').innerHTML = html; }
function paint(html) { document.getElementById('content').innerHTML = html; }

/* ---------- data loading ---------- */

function loadChemicals(force) {
  if (S.loaded.chem && !force) return Promise.resolve(S.chemicals);
  return api('listChemicals').then(function (rows) {
    S.chemicals = rows; S.loaded.chem = true; return rows;
  });
}
function loadLocations(force) {
  if (S.loaded.loc && !force) return Promise.resolve(S.locations);
  return api('listLocations').then(function (rows) { S.locations = rows; S.loaded.loc = true; return rows; });
}
function refreshAll() {
  S.loaded = {};
  return Promise.all([api('getDashboard').then(function (d) { S.dash = d; }), loadChemicals(true)])
    .then(function () { renderNav(); go(S.view); });
}

/* =================================================================
 * DASHBOARD
 * ================================================================= */

function viewDashboard() {
  api('getDashboard').then(function (d) {
    S.dash = d;
    renderNav();
    const t = d.totals, c = d.compliance;
    setSub('Figures as at ' + fmtDateTime(d.generatedAt));

    const kpis = '<div class="kpis">' +
      kpi(t.chemicals, 'Active chemicals', '') +
      kpi(t.expired, 'Expired', t.expired ? 'bad' : 'ok') +
      kpi(t.expiringSoon, 'Expiring in ' + BOOT.expiryWindow + ' days', t.expiringSoon ? 'warn' : 'ok') +
      kpi(t.low + t.out, 'At or below minimum', (t.low + t.out) ? 'warn' : 'ok') +
      kpi(t.pendingRequests, 'Requests to decide', t.pendingRequests ? 'warn' : 'ok') +
      kpi(t.movementsThisMonth, 'Movements this month', '') +
      '</div>';

    const watch = d.watchlist.length
      ? '<div class="scroll"><table class="data"><thead><tr><th>Chemical</th><th>Location</th><th>Expiry</th><th>Status</th></tr></thead><tbody>' +
      d.watchlist.map(function (w) {
        const bad = w.days < 0;
        return '<tr class="clickable stripe ' + (bad ? 'CRITICAL' : 'WARN') + '" onclick="openChemical(\'' + w.id + '\')">' +
          '<td><span class="name">' + esc(w.name) + '</span><div class="sub mono">' + w.id + '</div></td>' +
          '<td class="sub">' + esc(w.location || '—') + '</td>' +
          '<td class="mono">' + fmtDate(w.expiryDate) + '</td>' +
          '<td><span class="tag ' + (bad ? 'bad' : 'warn') + '">' +
          (bad ? Math.abs(w.days) + ' days overdue' : w.days + ' days left') + '</span></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>Nothing expiring</b>Every dated container is inside its shelf life.</div>';

    const reorder = d.reorder.length
      ? '<div class="scroll"><table class="data"><thead><tr><th>Chemical</th><th class="num">On hand</th><th class="num">Minimum</th><th>Supplier</th></tr></thead><tbody>' +
      d.reorder.map(function (r) {
        return '<tr class="clickable stripe ' + (r.qty <= 0 ? 'CRITICAL' : 'WARN') + '" onclick="openChemical(\'' + r.id + '\')">' +
          '<td><span class="name">' + esc(r.name) + '</span><div class="sub mono">' + r.id + '</div></td>' +
          '<td class="num">' + fmtQty(r.qty) + ' ' + esc(r.unit) + '</td>' +
          '<td class="num">' + fmtQty(r.minStock) + '</td>' +
          '<td class="sub">' + esc(r.supplier || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>Stock levels are healthy</b>Nothing is at or below its minimum.</div>';

    const queue = (can('request.decide') && d.pendingQueue.length)
      ? '<div class="panel"><h3>Waiting for a decision</h3><table class="data"><tbody>' +
      d.pendingQueue.map(function (q) {
        return '<tr class="clickable stripe ' + (q.waitingDays > 3 ? 'WARN' : 'OK') + '" onclick="go(\'requests\')">' +
          '<td><span class="name">' + esc(q.chemName) + '</span><div class="sub">' + esc(q.requester) + ' · ' + q.id + '</div></td>' +
          '<td class="num">' + fmtQty(q.qty) + ' ' + esc(q.unit) + '</td>' +
          '<td class="sub">waiting ' + q.waitingDays + ' day' + (q.waitingDays === 1 ? '' : 's') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '';

    const mine = d.mine
      ? '<div class="panel"><h3>My requests</h3><div class="body"><dl class="kv">' +
      '<dt>Awaiting decision</dt><dd>' + d.mine.pending + '</dd>' +
      '<dt>Approved, not collected</dt><dd>' + d.mine.approved + '</dd>' +
      '<dt>Issued</dt><dd>' + d.mine.issued + '</dd></dl>' +
      '<button class="btn primary sm" style="margin-top:12px" onclick="openRequestForm()">Request a chemical</button>' +
      '</div></div>'
      : '';

    const compliance = can('dashboard.view') && !d.mine
      ? '<div class="panel"><h3>Compliance</h3><div class="body">' +
      '<div class="gauge"><span class="score" style="color:' + scoreColour(c.score) + '">' + c.score + '%</span>' +
      '<span class="sub">' + esc(c.band) + '</span></div>' +
      meter('Safety data sheets on file', c.sdsCoverage) +
      meter('Containers within expiry', c.expiryCompliance) +
      meter('Stock above minimum', c.stockHealth) +
      (c.missingSds ? '<p class="hint">' + c.missingSds + ' chemical(s) have no safety data sheet linked.</p>' : '') +
      '</div></div>'
      : '';

    paint(kpis +
      '<div class="cols" style="margin-top:18px">' +
      '<div class="stack">' +
      '<div class="panel"><h3>Expiry watchlist</h3>' + watch + '</div>' +
      '<div class="panel"><h3>Reorder list</h3>' + reorder + '</div>' +
      (d.topChemicals.length ? '<div class="panel"><h3>Most handled this month</h3><div class="body">' +
        barChart(d.topChemicals) + '</div></div>' : '') +
      '</div>' +
      '<div class="stack">' +
      compliance + mine + queue +
      '<div class="panel"><h3>Movements over six months</h3><div class="body">' + trendChart(d.trend) + '</div></div>' +
      '<div class="panel"><h3>Stored by hazard class</h3><div class="body">' + barChart(d.byStorageClass) + '</div></div>' +
      '</div></div>');
  }).catch(fail);
}

function kpi(n, label, tone) {
  return '<div class="kpi ' + (tone || '') + '"><div class="n">' + n + '</div><div class="l">' + esc(label) + '</div></div>';
}
function scoreColour(v) { return v >= 90 ? 'var(--ok)' : (v >= 75 ? 'var(--warn)' : 'var(--bad)'); }
function meter(label, pct) {
  return '<div style="margin-top:13px"><div style="display:flex;justify-content:space-between;font-size:13px">' +
    '<span>' + esc(label) + '</span><span class="mono">' + pct + '%</span></div>' +
    '<div class="meter"><i style="width:' + pct + '%;background:' + scoreColour(pct) + '"></i></div></div>';
}
function barChart(items) {
  if (!items || !items.length) return '<p class="sub">Nothing recorded yet.</p>';
  const max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
  return '<div class="bars">' + items.slice(0, 8).map(function (i) {
    return '<div class="bar"><span class="sub" title="' + esc(i.label) + '">' + esc(i.label) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + Math.round(i.value / max * 100) + '%"></span></span>' +
      '<span class="v">' + i.value + '</span></div>';
  }).join('') + '</div>';
}
function trendChart(trend) {
  const max = Math.max(1, Math.max.apply(null, trend.map(function (t) {
    return Math.max(t.issues, t.receipts, t.disposals);
  })));
  const w = 300, h = 120, gap = w / trend.length;
  let bars = '';
  trend.forEach(function (t, i) {
    const x = i * gap + 8;
    const bw = (gap - 18) / 3;
    [['issues', 'var(--teal)'], ['receipts', 'var(--ok)'], ['disposals', 'var(--bad)']].forEach(function (s, j) {
      const bh = Math.round(t[s[0]] / max * (h - 26));
      bars += '<rect x="' + (x + j * (bw + 2)) + '" y="' + (h - 20 - bh) + '" width="' + bw +
        '" height="' + Math.max(bh, t[s[0]] ? 2 : 0) + '" fill="' + s[1] + '"><title>' +
        t.label + ' ' + s[0] + ': ' + t[s[0]] + '</title></rect>';
    });
    bars += '<text x="' + (x + gap / 2 - 12) + '" y="' + (h - 6) + '" font-size="10" fill="#5b6b74">' + t.label + '</text>';
  });
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto" role="img" aria-label="Movements over six months">' +
    '<line x1="0" y1="' + (h - 20) + '" x2="' + w + '" y2="' + (h - 20) + '" stroke="#d6dfe0"/>' + bars + '</svg>' +
    '<div class="tags" style="margin-top:8px;font-size:12px;color:#5b6b74">' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:var(--teal)"></span> issued</span>&nbsp;&nbsp;' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:var(--ok)"></span> received</span>&nbsp;&nbsp;' +
    '<span><span style="display:inline-block;width:9px;height:9px;background:var(--bad)"></span> disposed</span></div>';
}

/* =================================================================
 * INVENTORY
 * ================================================================= */

const STATUS_FILTERS = [
  ['ALL', 'Everything'], ['ATTENTION', 'Needs attention'], ['EXPIRED', 'Expired'],
  ['EXPIRING', 'Expiring soon'], ['LOW', 'Low or out'], ['NO_SDS', 'No safety sheet']
];

function viewInventory() {
  Promise.all([loadChemicals(), loadLocations()]).then(function () {
    setActions(
      (can('inventory.edit') ? '<button class="btn primary" onclick="openChemicalForm()">Add chemical</button>' : '') +
      '<button class="btn" onclick="openScan()">Scan QR</button>' +
      (can('export') ? '<button class="btn" onclick="download(\'inventory\')">Export CSV</button>' : ''));
    renderInventory();
  }).catch(fail);
}

function renderInventory() {
  const cats = ['ALL'].concat(S.chemicals.map(function (c) { return c.category || 'Uncategorised'; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort());

  const controls =
    '<div class="panel" style="margin-bottom:16px"><div class="body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">' +
    '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input id="q" placeholder="Search name, CAS, lot, location" value="' + esc(S.filter.text) + '" oninput="S.filter.text=this.value;renderRows()"></div>' +
    '<select style="width:auto;min-width:170px" onchange="S.filter.category=this.value;renderRows()">' +
    cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (S.filter.category === c ? ' selected' : '') + '>' +
        (c === 'ALL' ? 'All categories' : esc(c)) + '</option>';
    }).join('') + '</select>' +
    '<div class="chips">' + STATUS_FILTERS.map(function (f) {
      return '<button class="chip ' + (S.filter.status === f[0] ? 'on' : '') + '" onclick="S.filter.status=\'' + f[0] + '\';renderRows()">' + f[1] + '</button>';
    }).join('') + '</div></div></div>' +
    '<div class="panel"><div id="rows"></div></div>';

  paint(controls);
  renderRows();
}

function matchFilter(c) {
  const f = S.filter;
  if (f.category !== 'ALL' && (c.category || 'Uncategorised') !== f.category) return false;
  if (f.status === 'ATTENTION' && c.status === 'OK') return false;
  if (f.status === 'EXPIRED' && c.flags.indexOf('EXPIRED') < 0) return false;
  if (f.status === 'EXPIRING' && c.flags.indexOf('EXPIRING') < 0 && c.flags.indexOf('CRITICAL') < 0) return false;
  if (f.status === 'LOW' && c.flags.indexOf('LOW') < 0 && c.flags.indexOf('OUT') < 0) return false;
  if (f.status === 'NO_SDS' && c.flags.indexOf('NO_SDS') < 0) return false;
  if (f.text) {
    const hay = [c.name, c.cas, c.id, c.lotNo, c.location, c.supplier, c.category, c.hazardClass].join(' ').toLowerCase();
    if (hay.indexOf(f.text.toLowerCase()) < 0) return false;
  }
  return true;
}

const RANK = { CRITICAL: 0, WARN: 1, WATCH: 2, OK: 3 };

function renderRows() {
  const rows = S.chemicals.filter(matchFilter).sort(function (a, b) {
    if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
    return a.name.localeCompare(b.name);
  });

  setSub(rows.length + ' of ' + S.chemicals.length + ' chemicals');

  const host = document.getElementById('rows');
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<div class="empty"><b>No chemicals match</b>Clear the search or pick a different filter.' +
      (can('inventory.edit') ? '<div style="margin-top:14px"><button class="btn primary" onclick="openChemicalForm()">Add a chemical</button></div>' : '') +
      '</div>';
    return;
  }

  host.innerHTML = '<div class="scroll"><table class="data"><thead><tr>' +
    '<th>Chemical</th><th>Location</th><th class="num">On hand</th><th class="num">Minimum</th>' +
    '<th>Expiry</th><th>Flags</th><th></th></tr></thead><tbody>' +
    rows.map(function (c) {
      return '<tr class="clickable stripe ' + c.status + '" onclick="openChemical(\'' + c.id + '\')">' +
        '<td><span class="name">' + esc(c.name) + '</span>' +
        '<div class="sub"><span class="mono">' + c.id + '</span>' +
        (c.cas ? ' · CAS ' + esc(c.cas) : '') + (c.category ? ' · ' + esc(c.category) : '') + '</div></td>' +
        '<td class="sub">' + esc(c.location || '—') + '</td>' +
        '<td class="num">' + fmtQty(c.qty) + ' ' + esc(c.unit) + '</td>' +
        '<td class="num sub">' + fmtQty(c.minStock) + '</td>' +
        '<td class="mono">' + (c.expiryDate ? fmtDate(c.expiryDate) : '—') +
        (c.daysToExpiry !== null && c.daysToExpiry <= BOOT.expiryWindow
          ? '<div class="sub">' + (c.daysToExpiry < 0 ? Math.abs(c.daysToExpiry) + ' days overdue' : c.daysToExpiry + ' days left') + '</div>' : '') +
        '</td>' +
        '<td>' + flagTags(c) + '</td>' +
        '<td class="sub" style="text-align:right">' + (c.sdsUrl ? 'SDS' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function flagTags(c) {
  const map = {
    EXPIRED: ['bad', 'Expired'], CRITICAL: ['bad', 'Expires this week'],
    EXPIRING: ['warn', 'Expiring'], OUT: ['bad', 'Out of stock'],
    LOW: ['warn', 'Low'], NO_SDS: ['info', 'No SDS']
  };
  if (!c.flags.length) return '<span class="tag ok">OK</span>';
  return '<span class="tags">' + c.flags.map(function (f) {
    return '<span class="tag ' + map[f][0] + '">' + map[f][1] + '</span>';
  }).join('') + '</span>';
}

/* ---------- chemical drawer ---------- */

function openChemical(id) {
  showDrawer('<div><h3>Loading…</h3></div>', '<div class="loading">Fetching the record…</div>', '');
  api('getChemical', id).then(function (c) {
    const head = '<div style="flex:1"><h3>' + esc(c.name) + '</h3>' +
      '<div class="sub"><span class="mono">' + c.id + '</span>' + (c.cas ? ' · CAS ' + esc(c.cas) : '') + '</div>' +
      '<div class="tags" style="margin-top:8px">' + flagTags(c) +
      c.ghs.map(function (g) { return '<span class="tag mute">' + esc(g) + '</span>'; }).join('') + '</div></div>';

    const body =
      '<dl class="kv">' +
      '<dt>On the shelf</dt><dd class="mono"><b>' + fmtQty(c.qty) + ' ' + esc(c.unit) + '</b>' +
      (c.containerCount ? ' in ' + c.containerCount + ' × ' + esc(c.containerSize) : '') + '</dd>' +
      '<dt>Minimum stock</dt><dd class="mono">' + fmtQty(c.minStock) + ' ' + esc(c.unit) + '</dd>' +
      '<dt>Location</dt><dd>' + esc(c.location || '—') + '</dd>' +
      '<dt>Storage class</dt><dd>' + esc(c.storageClass || '—') + '</dd>' +
      '<dt>Hazard class</dt><dd>' + esc(c.hazardClass || '—') + '</dd>' +
      '<dt>Supplier</dt><dd>' + esc(c.supplier || '—') + (c.catalogNo ? ' · ' + esc(c.catalogNo) : '') + '</dd>' +
      '<dt>Lot</dt><dd class="mono">' + esc(c.lotNo || '—') + '</dd>' +
      '<dt>Received</dt><dd>' + fmtDate(c.dateReceived) + '</dd>' +
      '<dt>Expiry</dt><dd>' + fmtDate(c.expiryDate) +
      (c.daysToExpiry !== null ? ' <span class="sub">(' + (c.daysToExpiry < 0 ? Math.abs(c.daysToExpiry) + ' days overdue' : c.daysToExpiry + ' days left') + ')</span>' : '') + '</dd>' +
      '<dt>Safety data sheet</dt><dd>' + (c.sds
        ? '<a href="' + esc(c.sds.url) + '" target="_blank" rel="noopener">Open sheet</a> <span class="sub">v' +
        esc(c.sds.version) + ', revised ' + fmtDate(c.sds.revisionDate) + '</span>'
        : '<span class="tag info">Not on file</span>') + '</dd>' +
      (c.notes ? '<dt>Notes</dt><dd>' + esc(c.notes) + '</dd>' : '') +
      '<dt>Last updated</dt><dd class="sub">' + fmtDateTime(c.updatedAt) + ' by ' + esc(c.updatedBy || '—') + '</dd>' +
      '</dl>' +

      '<div class="qrbox" style="margin:18px 0"><img src="' + esc(c.qrUrl) + '" alt="QR code for ' + esc(c.id) + '">' +
      '<div class="hint">Scanning this code opens this record</div></div>' +

      '<h4 style="margin:18px 0 8px">Usage history</h4>' +
      (c.history.length
        ? '<table class="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th class="num">Change</th><th class="num">Balance</th></tr></thead><tbody>' +
        c.history.map(function (h) {
          return '<tr><td class="sub">' + fmtDateTime(h.timestamp) + '</td>' +
            '<td class="sub">' + esc(h.user) + '</td>' +
            '<td>' + esc(h.action.charAt(0) + h.action.slice(1).toLowerCase()) +
            (h.purpose ? '<div class="sub">' + esc(h.purpose) + '</div>' : '') + '</td>' +
            '<td class="num" style="color:' + (h.qtyChange < 0 ? 'var(--bad)' : 'var(--ok)') + '">' +
            (h.qtyChange > 0 ? '+' : '') + fmtQty(h.qtyChange) + '</td>' +
            '<td class="num">' + fmtQty(h.qtyAfter) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="sub">No movements recorded yet.</p>');

    const actions =
      (can('usage.log') ? '<button class="btn primary" onclick="openMovement(\'' + c.id + '\')">Record movement</button>' : '') +
      (can('request.create') ? '<button class="btn" onclick="openRequestForm(\'' + c.id + '\')">Request</button>' : '') +
      (can('inventory.edit') ? '<button class="btn" onclick="openChemicalForm(\'' + c.id + '\')">Edit</button>' : '') +
      (can('sds.upload') ? '<button class="btn" onclick="openSdsUpload(\'' + c.id + '\')">Upload SDS</button>' : '') +
      (can('qr.print') ? '<button class="btn" onclick="printLabels([\'' + c.id + '\'])">Print label</button>' : '');

    showDrawer(head, body, actions);
  }).catch(function (e) { closeLayer(); fail(e); });
}

/* ---------- chemical form ---------- */

const UNITS = ['g', 'kg', 'mg', 'mL', 'L', 'units', 'bottles'];
const STORAGE_CLASSES = ['General', 'Flammable', 'Corrosive', 'Oxidiser', 'Toxic / Scheduled', 'Refrigerated', 'Compressed gas'];
const GHS_CODES = [
  ['GHS01', 'Explosive'], ['GHS02', 'Flammable'], ['GHS03', 'Oxidising'], ['GHS04', 'Gas under pressure'],
  ['GHS05', 'Corrosive'], ['GHS06', 'Acute toxicity'], ['GHS07', 'Harmful / irritant'],
  ['GHS08', 'Health hazard'], ['GHS09', 'Environmental hazard']
];

function openChemicalForm(id) {
  const c = id ? S.chemicals.filter(function (x) { return x.id === id; })[0] : null;
  const locOptions = S.locations.map(function (l) {
    const path = l.path + (l.shelf ? ' / ' + l.shelf : '');
    return '<option value="' + esc(path) + '"' + (c && c.location === path ? ' selected' : '') + '>' + esc(path) + '</option>';
  }).join('');

  const body =
    '<div class="field"><label for="f_name">Chemical name</label>' +
    '<input id="f_name" value="' + esc(c ? c.name : '') + '" placeholder="Acetone"></div>' +
    '<div class="grid3">' +
    '<div class="field"><label for="f_cas">CAS number</label><input id="f_cas" value="' + esc(c ? c.cas : '') + '" placeholder="67-64-1"></div>' +
    '<div class="field"><label for="f_cat">Category</label><input id="f_cat" value="' + esc(c ? c.category : '') + '" placeholder="Solvent"></div>' +
    '<div class="field"><label for="f_state">Physical state</label><select id="f_state">' +
    ['Liquid', 'Solid', 'Gas', 'Solution'].map(function (s) {
      return '<option' + (c && c.physicalState === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('') + '</select></div></div>' +

    '<div class="field"><label for="f_hazard">Hazard class</label>' +
    '<input id="f_hazard" value="' + esc(c ? c.hazardClass : '') + '" placeholder="Flammable liquid, category 2"></div>' +

    '<div class="field"><label>GHS pictograms</label><div class="chips" id="f_ghs">' +
    GHS_CODES.map(function (g) {
      const on = c && c.ghs.indexOf(g[0]) >= 0;
      return '<button type="button" class="chip ' + (on ? 'on' : '') + '" data-code="' + g[0] +
        '" onclick="this.classList.toggle(\'on\')">' + g[0] + ' ' + g[1] + '</button>';
    }).join('') + '</div></div>' +

    '<div class="grid3">' +
    (id ? '' : '<div class="field"><label for="f_qty">Opening quantity</label><input id="f_qty" type="number" step="any" value="0"></div>') +
    '<div class="field"><label for="f_unit">Unit</label><select id="f_unit">' +
    UNITS.map(function (u) { return '<option' + (c && c.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="field"><label for="f_min">Minimum stock</label><input id="f_min" type="number" step="any" value="' + (c ? c.minStock : 0) + '"></div>' +
    '<div class="field"><label for="f_reorder">Reorder quantity</label><input id="f_reorder" type="number" step="any" value="' + (c ? c.reorderQty : 0) + '"></div>' +
    '</div>' +

    '<div class="grid2">' +
    '<div class="field"><label for="f_size">Container size</label><input id="f_size" value="' + esc(c ? c.containerSize : '') + '" placeholder="2.5 L"></div>' +
    '<div class="field"><label for="f_count">Number of containers</label><input id="f_count" type="number" step="1" value="' + (c ? c.containerCount : 1) + '"></div>' +
    '</div>' +

    '<div class="grid2">' +
    '<div class="field"><label for="f_loc">Storage location</label><select id="f_loc"><option value="">Not assigned</option>' + locOptions + '</select></div>' +
    '<div class="field"><label for="f_class">Storage class</label><select id="f_class">' +
    STORAGE_CLASSES.map(function (s) { return '<option' + (c && c.storageClass === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select></div></div>' +

    '<div class="grid3">' +
    '<div class="field"><label for="f_supplier">Supplier</label><input id="f_supplier" value="' + esc(c ? c.supplier : '') + '"></div>' +
    '<div class="field"><label for="f_catalog">Catalogue number</label><input id="f_catalog" value="' + esc(c ? c.catalogNo : '') + '"></div>' +
    '<div class="field"><label for="f_lot">Lot / batch</label><input id="f_lot" value="' + esc(c ? c.lotNo : '') + '"></div>' +
    '</div>' +

    '<div class="grid2">' +
    '<div class="field"><label for="f_received">Date received</label><input id="f_received" type="date" value="' + esc(c ? String(c.dateReceived).substring(0, 10) : today()) + '"></div>' +
    '<div class="field"><label for="f_expiry">Expiry date</label><input id="f_expiry" type="date" value="' + esc(c ? String(c.expiryDate).substring(0, 10) : '') + '"></div>' +
    '</div>' +

    '<div class="field"><label for="f_notes">Notes</label><textarea id="f_notes" placeholder="Handling notes, incompatibilities, decanting rules">' + esc(c ? c.notes : '') + '</textarea></div>';

  showModal(id ? 'Edit ' + c.name : 'Add a chemical', body,
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" id="saveChem" onclick="saveChemical(' + (id ? "'" + id + "'" : 'null') + ',this)">' +
    (id ? 'Save changes' : 'Add chemical') + '</button>');
}

function saveChemical(id, btn) {
  const ghs = Array.prototype.slice.call(document.querySelectorAll('#f_ghs .chip.on'))
    .map(function (b) { return b.dataset.code; });
  const form = {
    id: id, name: val('f_name'), cas: val('f_cas'), category: val('f_cat'),
    physicalState: val('f_state'), hazardClass: val('f_hazard'), ghs: ghs,
    qty: val('f_qty') || 0, unit: val('f_unit'), minStock: val('f_min'), reorderQty: val('f_reorder'),
    containerSize: val('f_size'), containerCount: val('f_count'),
    location: val('f_loc'), storageClass: val('f_class'), supplier: val('f_supplier'),
    catalogNo: val('f_catalog'), lotNo: val('f_lot'),
    dateReceived: val('f_received'), expiryDate: val('f_expiry'), notes: val('f_notes')
  };
  setBusy(btn, true, 'Saving…');
  api('saveChemical', form).then(function (res) {
    closeLayer(); toast(res.message);
    return loadChemicals(true).then(function () { go(S.view); });
  }).catch(function (e) { setBusy(btn, false); fail(e); });
}

/* ---------- stock movement ---------- */

function openMovement(id, reqId) {
  const c = S.chemicals.filter(function (x) { return x.id === id; })[0];
  if (!c) return fail(new Error('Reload the page and try again.'));
  const staff = can('stock.adjust');
  const actions = staff
    ? [['ISSUE', 'Issue — take from the shelf'], ['RETURN', 'Return — put unused stock back'],
       ['RECEIVE', 'Receive — new delivery'], ['DISPOSE', 'Dispose — waste or expired'],
       ['ADJUST', 'Stocktake — set the exact amount'], ['TRANSFER', 'Transfer — move to another location']]
    : [['ISSUE', 'Issue — take from the shelf'], ['RETURN', 'Return — put unused stock back']];

  const body =
    '<p class="sub">' + esc(c.name) + ' · currently <b class="mono">' + fmtQty(c.qty) + ' ' + esc(c.unit) + '</b> in ' + esc(c.location || 'no assigned location') + '</p>' +
    '<div class="field"><label for="m_action">Movement</label><select id="m_action" onchange="movementHint()">' +
    actions.map(function (a) { return '<option value="' + a[0] + '">' + a[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="grid2">' +
    '<div class="field"><label for="m_amount">Quantity in ' + esc(c.unit) + '</label><input id="m_amount" type="number" step="any" min="0" value=""></div>' +
    '<div class="field"><label for="m_containers">Containers left (optional)</label><input id="m_containers" type="number" step="1" value="' + (c.containerCount || '') + '"></div>' +
    '</div>' +
    '<div class="field" id="m_locwrap" style="display:none"><label for="m_newloc">New location</label>' +
    '<select id="m_newloc">' + S.locations.map(function (l) {
      return '<option value="' + esc(l.path) + '">' + esc(l.path) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field"><label for="m_purpose">Purpose or experiment</label>' +
    '<input id="m_purpose" placeholder="Titration practical, CHM241 group B"></div>' +
    '<div class="field"><label for="m_notes">Notes</label><input id="m_notes" placeholder="Optional"></div>' +
    '<p class="hint" id="m_hint">Issuing subtracts from the balance and writes a line in the usage history.</p>';

  showModal('Record a movement', body,
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" id="mSave" onclick="saveMovement(\'' + id + '\',' + (reqId ? "'" + reqId + "'" : 'null') + ',this)">Record movement</button>');
}

function movementHint() {
  const a = val('m_action');
  const hints = {
    ISSUE: 'Issuing subtracts from the balance and writes a line in the usage history.',
    RETURN: 'Returning adds the unused amount back to the balance.',
    RECEIVE: 'Receiving adds a new delivery to the balance.',
    DISPOSE: 'Disposal subtracts the amount and marks it as waste for the compliance report.',
    ADJUST: 'Stocktake replaces the balance with the exact amount you measured.',
    TRANSFER: 'Transfer keeps the balance and changes the storage location.'
  };
  document.getElementById('m_hint').textContent = hints[a] || '';
  document.getElementById('m_locwrap').style.display = a === 'TRANSFER' ? 'block' : 'none';
}

function saveMovement(id, reqId, btn) {
  setBusy(btn, true, 'Recording…');
  api('recordMovement', {
    chemId: id, action: val('m_action'), amount: val('m_amount') || 0,
    containerCount: val('m_containers'), newLocation: val('m_newloc'),
    purpose: val('m_purpose'), notes: val('m_notes'), reqId: reqId || ''
  }).then(function (msg) {
    closeLayer(); toast(msg);
    return loadChemicals(true).then(function () { go(S.view); });
  }).catch(function (e) { setBusy(btn, false); fail(e); });
}

/* =================================================================
 * REQUESTS
 * ================================================================= */

const REQ_STATUS = ['ALL', 'PENDING', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED'];

function viewRequests() {
  Promise.all([loadChemicals(), api('listRequests', {})]).then(function (r) {
    S.requests = r[1];
    setActions(
      (can('request.create') ? '<button class="btn primary" onclick="openRequestForm()">New request</button>' : '') +
      (can('export') ? '<button class="btn" onclick="download(\'requests\')">Export CSV</button>' : ''));
    renderRequests();
  }).catch(fail);
}

function renderRequests() {
  const rows = S.requests.filter(function (r) { return S.reqFilter === 'ALL' || r.status === S.reqFilter; });
  setSub(can('request.viewAll') ? rows.length + ' requests' : rows.length + ' of my requests');

  const chips = '<div class="panel" style="margin-bottom:16px"><div class="body"><div class="chips">' +
    REQ_STATUS.map(function (s) {
      const n = s === 'ALL' ? S.requests.length : S.requests.filter(function (r) { return r.status === s; }).length;
      return '<button class="chip ' + (S.reqFilter === s ? 'on' : '') + '" onclick="S.reqFilter=\'' + s + '\';renderRequests()">' +
        (s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()) + ' (' + n + ')</button>';
    }).join('') + '</div></div></div>';

  const tone = { PENDING: 'warn', APPROVED: 'info', ISSUED: 'ok', REJECTED: 'bad', CANCELLED: 'mute' };
  const stripe = { PENDING: 'WARN', APPROVED: 'WATCH', ISSUED: 'OK', REJECTED: 'CRITICAL', CANCELLED: 'OK' };

  const table = rows.length
    ? '<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
    '<th>Request</th>' + (can('request.viewAll') ? '<th>Requester</th>' : '') +
    '<th>Chemical</th><th class="num">Quantity</th><th>Needed by</th><th>Status</th><th>Action</th>' +
    '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr class="stripe ' + stripe[r.status] + '">' +
        '<td><span class="mono name">' + r.id + '</span><div class="sub">' + fmtDateTime(r.timestamp) + '</div></td>' +
        (can('request.viewAll') ? '<td>' + esc(r.requesterName || r.requester) + '<div class="sub">' + esc(r.requester) + '</div></td>' : '') +
        '<td><span class="name">' + esc(r.chemName) + '</span><div class="sub">' + esc(r.purpose) + '</div></td>' +
        '<td class="num">' + fmtQty(r.qtyRequested) + ' ' + esc(r.unit) +
        (r.issuedQty !== null ? '<div class="sub">issued ' + fmtQty(r.issuedQty) + '</div>' : '') + '</td>' +
        '<td class="sub">' + (r.neededBy ? fmtDate(r.neededBy) : '—') + '</td>' +
        '<td><span class="tag ' + tone[r.status] + '">' + r.status.charAt(0) + r.status.slice(1).toLowerCase() + '</span>' +
        (r.comment ? '<div class="sub">' + esc(r.comment) + '</div>' : '') + '</td>' +
        '<td><div class="row-actions">' + requestActions(r) + '</div></td></tr>';
    }).join('') + '</tbody></table></div></div>'
    : '<div class="panel"><div class="empty"><b>No requests here</b>' +
    (can('request.create') ? 'Submit one and an approver gets an email straight away.' : 'Nothing has been submitted with this status.') + '</div></div>';

  paint(chips + table);
}

function requestActions(r) {
  let html = '';
  if (r.status === 'PENDING' && can('request.decide')) {
    html += '<button class="btn sm primary" onclick="openDecision(\'' + r.id + '\',\'APPROVED\')">Approve</button>' +
      '<button class="btn sm" onclick="openDecision(\'' + r.id + '\',\'REJECTED\')">Reject</button>';
  }
  if (r.status === 'APPROVED' && can('request.issue')) {
    html += '<button class="btn sm primary" onclick="openIssue(\'' + r.id + '\',' + r.qtyRequested + ')">Issue</button>';
  }
  if ((r.status === 'PENDING' || r.status === 'APPROVED') && (r.mine || can('request.decide'))) {
    html += '<button class="btn sm ghost" onclick="cancelReq(\'' + r.id + '\')">Cancel</button>';
  }
  return html || '<span class="sub">—</span>';
}

function openRequestForm(chemId) {
  const options = S.chemicals.map(function (c) {
    return '<option value="' + c.id + '"' + (chemId === c.id ? ' selected' : '') + '>' +
      esc(c.name) + ' — ' + fmtQty(c.qty) + ' ' + esc(c.unit) + ' available</option>';
  }).join('');

  showModal('Request a chemical',
    '<div class="field"><label for="r_chem">Chemical</label><select id="r_chem">' + options + '</select></div>' +
    '<div class="grid2">' +
    '<div class="field"><label for="r_qty">Quantity needed</label><input id="r_qty" type="number" step="any" min="0"></div>' +
    '<div class="field"><label for="r_by">Needed by</label><input id="r_by" type="date" value="' + today() + '"></div>' +
    '</div>' +
    '<div class="field"><label for="r_purpose">What is it for?</label>' +
    '<textarea id="r_purpose" placeholder="Experiment, course code, supervisor — the approver reads this"></textarea></div>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" id="rSave" onclick="submitReq(this)">Submit request</button>');
}

function submitReq(btn) {
  setBusy(btn, true, 'Submitting…');
  api('submitRequest', {
    chemId: val('r_chem'), qty: val('r_qty'), neededBy: val('r_by'), purpose: val('r_purpose')
  }).then(function (msg) { closeLayer(); toast(msg); go('requests'); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function openDecision(reqId, decision) {
  showModal(decision === 'APPROVED' ? 'Approve ' + reqId : 'Reject ' + reqId,
    '<div class="field"><label for="d_comment">Comment' +
    (decision === 'REJECTED' ? ' (required)' : ' (optional)') + '</label>' +
    '<textarea id="d_comment" placeholder="' +
    (decision === 'APPROVED' ? 'Collection instructions, decanting limits' : 'Tell the requester what to change') + '"></textarea></div>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn ' + (decision === 'APPROVED' ? 'primary' : 'danger') + '" onclick="sendDecision(\'' + reqId + '\',\'' + decision + '\',this)">' +
    (decision === 'APPROVED' ? 'Approve request' : 'Reject request') + '</button>');
}

function sendDecision(reqId, decision, btn) {
  setBusy(btn, true, 'Sending…');
  api('decideRequest', { reqId: reqId, decision: decision, comment: val('d_comment') })
    .then(function (msg) { closeLayer(); toast(msg); go('requests'); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function openIssue(reqId, qty) {
  showModal('Issue against ' + reqId,
    '<div class="field"><label for="i_qty">Quantity handed over</label>' +
    '<input id="i_qty" type="number" step="any" value="' + qty + '"></div>' +
    '<div class="field"><label for="i_notes">Notes</label><input id="i_notes" placeholder="Decanted into 250 mL amber bottle"></div>' +
    '<p class="hint">Issuing subtracts the amount from stock and writes the usage entry automatically.</p>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="sendIssue(\'' + reqId + '\',this)">Issue chemical</button>');
}

function sendIssue(reqId, btn) {
  setBusy(btn, true, 'Issuing…');
  api('issueRequest', { reqId: reqId, qty: val('i_qty'), notes: val('i_notes') })
    .then(function (msg) { closeLayer(); toast(msg); S.loaded.chem = false; go('requests'); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function cancelReq(reqId) {
  api('cancelRequest', reqId).then(function (msg) { toast(msg); go('requests'); }).catch(fail);
}

/* =================================================================
 * SAFETY DATA SHEETS
 * ================================================================= */

function viewSds() {
  Promise.all([loadChemicals(), api('listSds')]).then(function (r) {
    S.sds = r[1];
    setActions(can('sds.upload') ? '<button class="btn primary" onclick="openSdsUpload()">Upload sheet</button>' : '');
    const missing = S.chemicals.filter(function (c) { return !c.sdsId; });
    setSub(S.sds.length + ' sheets on file · ' + missing.length + ' chemicals without one');

    const missingPanel = missing.length
      ? '<div class="panel" style="margin-bottom:18px"><h3>Chemicals with no safety data sheet</h3>' +
      '<div class="body"><div class="tags">' + missing.map(function (c) {
        return '<button class="chip" onclick="' + (can('sds.upload') ? 'openSdsUpload(\'' + c.id + '\')' : 'openChemical(\'' + c.id + '\')') + '">' +
          esc(c.name) + '</button>';
      }).join('') + '</div>' +
      '<p class="hint">A sheet must be reachable within seconds of an incident. These are the gaps.</p></div></div>'
      : '';

    const table = S.sds.length
      ? '<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
      '<th>Chemical</th><th>Manufacturer</th><th>Version</th><th>Revised</th><th>Uploaded</th><th></th>' +
      '</tr></thead><tbody>' + S.sds.map(function (s) {
        const stale = s.ageDays !== null && s.ageDays > 365 * 3;
        return '<tr class="stripe ' + (stale ? 'WATCH' : 'OK') + '">' +
          '<td><span class="name">' + esc(s.chemName) + '</span><div class="sub mono">' + esc(s.chemId) + ' · ' + esc(s.id) + '</div></td>' +
          '<td class="sub">' + esc(s.manufacturer || '—') + '</td>' +
          '<td class="mono">' + esc(s.version) + '</td>' +
          '<td>' + fmtDate(s.revisionDate) + (stale ? '<div class="sub">over 3 years old</div>' : '') + '</td>' +
          '<td class="sub">' + fmtDate(s.uploadedAt) + '<div class="sub">' + esc(s.uploadedBy) + '</div></td>' +
          '<td><div class="row-actions"><a class="btn sm" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open</a>' +
          (can('*') ? '<button class="btn sm ghost" onclick="removeSds(\'' + s.id + '\')">Delete</button>' : '') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>'
      : '<div class="panel"><div class="empty"><b>No sheets stored yet</b>Upload the manufacturer PDF for each chemical you hold.</div></div>';

    paint(missingPanel + table);
  }).catch(fail);
}

function openSdsUpload(chemId) {
  const options = S.chemicals.map(function (c) {
    return '<option value="' + c.id + '"' + (chemId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  }).join('');
  showModal('Upload a safety data sheet',
    '<div class="field"><label for="s_chem">Chemical</label><select id="s_chem">' + options + '</select></div>' +
    '<div class="field"><label for="s_file">PDF file</label><input id="s_file" type="file" accept="application/pdf,.pdf"></div>' +
    '<div class="grid3">' +
    '<div class="field"><label for="s_manu">Manufacturer</label><input id="s_manu"></div>' +
    '<div class="field"><label for="s_ver">Version</label><input id="s_ver" value="1"></div>' +
    '<div class="field"><label for="s_rev">Revision date</label><input id="s_rev" type="date" value="' + today() + '"></div>' +
    '</div>' +
    '<p class="hint">The file is stored in the LabChem Drive folder and linked to the chemical record.</p>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="sendSds(this)">Upload sheet</button>');
}

function sendSds(btn) {
  const input = document.getElementById('s_file');
  if (!input.files.length) return fail(new Error('Choose a PDF file first.'));
  const file = input.files[0];
  setBusy(btn, true, 'Uploading…');
  const reader = new FileReader();
  reader.onload = function () {
    api('uploadSds', {
      chemId: val('s_chem'), filename: file.name, mimeType: file.type || 'application/pdf',
      base64: reader.result.split(',')[1], manufacturer: val('s_manu'),
      version: val('s_ver'), revisionDate: val('s_rev')
    }).then(function (res) {
      closeLayer(); toast(res.message); S.loaded.chem = false; go('sds');
    }).catch(function (e) { setBusy(btn, false); fail(e); });
  };
  reader.onerror = function () { setBusy(btn, false); fail(new Error('That file could not be read.')); };
  reader.readAsDataURL(file);
}

function removeSds(id) {
  api('deleteSds', id).then(function (msg) { toast(msg); S.loaded.chem = false; go('sds'); }).catch(fail);
}

/* =================================================================
 * USAGE HISTORY
 * ================================================================= */

function viewUsage() {
  Promise.all([api('listUsage', S.usageFilter), loadChemicals(), loadLocations()]).then(function (r) {
    const rows = r[0];
    S.usage = rows;
    setActions(can('export') ? '<button class="btn" onclick="download(\'usage\')">Export CSV</button>' : '');
    setSub(rows.length + ' movements' + (can('usage.viewAll') ? '' : ' recorded by me'));

    const filters = '<div class="panel" style="margin-bottom:16px"><div class="body grid' +
      (can('usage.viewAll') ? '3' : '2') + '">' +
      '<div class="field"><label for="u_from">From</label><input id="u_from" type="date" value="' + esc(S.usageFilter.from) + '"></div>' +
      '<div class="field"><label for="u_to">To</label><input id="u_to" type="date" value="' + esc(S.usageFilter.to) + '"></div>' +
      '<div class="field"><label for="u_action">Movement</label><select id="u_action">' +
      ['', 'ISSUE', 'RETURN', 'RECEIVE', 'DISPOSE', 'ADJUST', 'TRANSFER'].map(function (a) {
        return '<option value="' + a + '"' + (S.usageFilter.action === a ? ' selected' : '') + '>' +
          (a ? a.charAt(0) + a.slice(1).toLowerCase() : 'Any movement') + '</option>';
      }).join('') + '</select></div>' +
      (can('usage.viewAll') ? '<div class="field"><label for="u_user">User contains</label><input id="u_user" value="' + esc(S.usageFilter.user) + '"></div>' : '') +
      '<div class="field" style="align-self:end"><button class="btn primary" onclick="applyUsageFilter()">Apply filters</button></div>' +
      '</div></div>';

    const table = rows.length
      ? '<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
      '<th>When</th><th>Chemical</th><th>User</th><th>Movement</th><th class="num">Change</th><th class="num">Balance</th><th>Purpose</th>' +
      '</tr></thead><tbody>' + rows.map(function (l) {
        return '<tr class="clickable stripe OK" onclick="openChemical(\'' + l.chemId + '\')">' +
          '<td class="sub">' + fmtDateTime(l.timestamp) + '</td>' +
          '<td><span class="name">' + esc(l.chemName) + '</span><div class="sub mono">' + esc(l.chemId) + '</div></td>' +
          '<td class="sub">' + esc(l.user) + '</td>' +
          '<td>' + esc(l.action.charAt(0) + l.action.slice(1).toLowerCase()) +
          (l.reqId ? '<div class="sub mono">' + esc(l.reqId) + '</div>' : '') + '</td>' +
          '<td class="num" style="color:' + (l.qtyChange < 0 ? 'var(--bad)' : (l.qtyChange > 0 ? 'var(--ok)' : 'inherit')) + '">' +
          (l.qtyChange > 0 ? '+' : '') + fmtQty(l.qtyChange) + ' ' + esc(l.unit) + '</td>' +
          '<td class="num">' + fmtQty(l.qtyAfter) + '</td>' +
          '<td class="sub">' + esc(l.purpose || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>'
      : '<div class="panel"><div class="empty"><b>No movements match</b>Widen the date range or clear the filters.</div></div>';

    paint(filters + table);
  }).catch(fail);
}

function applyUsageFilter() {
  S.usageFilter = {
    from: val('u_from'), to: val('u_to'), action: val('u_action'),
    user: document.getElementById('u_user') ? val('u_user') : ''
  };
  viewUsage();
}

/* =================================================================
 * QR LABELS
 * ================================================================= */

function viewLabels() {
  loadChemicals().then(function () {
    setActions('<button class="btn" onclick="selectAllLabels(true)">Select all</button>' +
      '<button class="btn" onclick="selectAllLabels(false)">Clear</button>' +
      '<button class="btn primary" onclick="printSelected()">Print selected labels</button>');
    setSub('Tick the containers you need labels for, then print onto A4 — two labels per row');

    paint('<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
      '<th class="checkcol"></th><th>Chemical</th><th>Location</th><th>Lot</th><th>Expiry</th><th>QR preview</th>' +
      '</tr></thead><tbody>' + S.chemicals.map(function (c) {
        return '<tr class="stripe ' + c.status + '">' +
          '<td class="checkcol"><input type="checkbox" style="width:auto" data-id="' + c.id + '"' +
          (S.selection[c.id] ? ' checked' : '') + ' onchange="S.selection[\'' + c.id + '\']=this.checked"></td>' +
          '<td><span class="name">' + esc(c.name) + '</span><div class="sub mono">' + c.id + '</div></td>' +
          '<td class="sub">' + esc(c.location || '—') + '</td>' +
          '<td class="mono sub">' + esc(c.lotNo || '—') + '</td>' +
          '<td class="mono">' + fmtDate(c.expiryDate) + '</td>' +
          '<td><button class="btn sm" onclick="printLabels([\'' + c.id + '\'])">Print one</button></td></tr>';
      }).join('') + '</tbody></table></div></div>');
  }).catch(fail);
}

function selectAllLabels(on) {
  S.chemicals.forEach(function (c) { S.selection[c.id] = on; });
  document.querySelectorAll('input[type=checkbox][data-id]').forEach(function (cb) { cb.checked = on; });
}

function printSelected() {
  const ids = Object.keys(S.selection).filter(function (k) { return S.selection[k]; });
  if (!ids.length) return fail(new Error('Tick at least one chemical.'));
  printLabels(ids);
}

function printLabels(ids) {
  api('getLabelSheetUrl', ids).then(function (url) {
    const w = window.open(url, '_blank');
    if (!w) toast('Allow pop-ups for this site, then print again.', true);
  }).catch(fail);
}

/* ---------- QR scanning ---------- */

function openScan() {
  showModal('Scan a label',
    '<div id="sc_camera" class="scanbox"><div class="scanhint">Starting the camera…</div></div>' +
    '<div class="field" style="margin-top:14px"><label for="sc_id">Or type the code printed on the label</label>' +
    '<input id="sc_id" placeholder="CHM-0001" onkeydown="if(event.key===\'Enter\')goScan()"></div>' +
    '<p class="hint" id="sc_note">Hold the QR steady inside the frame.</p>',
    '<button class="btn" onclick="stopScanner();closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="goScan()">Open record</button>');
  startScanner();
}

let SCANNER = null;

function startScanner() {
  const note = function (msg) { const n = document.getElementById('sc_note'); if (n) n.textContent = msg; };
  const box = document.getElementById('sc_camera');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    box.innerHTML = '<div class="scanhint">This browser cannot open the camera. Type the code instead.</div>';
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    box.innerHTML = '<div class="scanhint">The camera needs an https address. Type the code instead.</div>';
    return;
  }

  loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js').then(function () {
    box.innerHTML = '';
    SCANNER = new Html5Qrcode('sc_camera');
    return SCANNER.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      function (decoded) { stopScanner(); closeLayer(); openChemical(codeFromScan(decoded)); },
      function () { /* a frame without a code is normal, stay quiet */ }
    );
  }).catch(function (err) {
    box.innerHTML = '<div class="scanhint">The camera could not start. Type the code instead.</div>';
    note(err && err.message ? err.message : 'Allow camera access in your browser settings to scan.');
  });
}

function stopScanner() {
  if (!SCANNER) return;
  const s = SCANNER;
  SCANNER = null;
  try { s.stop().then(function () { s.clear(); }).catch(function () {}); } catch (e) { /* already stopped */ }
}

/** A label QR holds a full URL; pull the chemical ID back out of it. */
function codeFromScan(text) {
  const m = String(text).match(/chem=([A-Za-z0-9-]+)/);
  return (m ? m[1] : String(text).trim()).toUpperCase();
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function () { reject(new Error('The scanner library could not be downloaded.')); };
    document.head.appendChild(s);
  });
}

function goScan() {
  const id = val('sc_id').toUpperCase();
  if (!id) return fail(new Error('Enter the chemical ID from the label.'));
  closeLayer();
  openChemical(id);
}

/* =================================================================
 * PEOPLE
 * ================================================================= */

function viewPeople() {
  api('listUsers').then(function (rows) {
    S.users = rows;
    setActions('<button class="btn primary" onclick="openUserForm()">Add person</button>');
    const pending = rows.filter(function (u) { return String(u.status).toUpperCase() === 'PENDING'; });
    setSub(rows.length + ' accounts · ' + pending.length + ' waiting for approval');

    const tone = { ADMIN: 'solid', STAFF: 'info', STUDENT: 'mute', AUDITOR: 'ok' };
    paint('<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
      '<th>Person</th><th>Role</th><th>Department</th><th>Account</th><th>Last signed in</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (u) {
        const isPending = String(u.status).toUpperCase() === 'PENDING';
        let state = '<span class="sub">' + esc(u.status) + '</span>';
        if (isPending) state = '<span class="tag warn">Awaiting approval</span>';
        else if (u.locked) state = '<span class="tag bad">Locked until ' + esc(String(u.lockedUntil).substring(11, 16)) + '</span>';
        else if (u.mustChange) state = '<span class="tag info">Temporary password</span>';

        return '<tr class="stripe ' + (isPending || u.locked ? 'WARN' : 'OK') + '">' +
          '<td><span class="name">' + esc(u.name) + '</span><div class="sub">' + esc(u.email) + '</div></td>' +
          '<td><span class="tag ' + (tone[u.role] || 'mute') + '">' + esc(u.roleLabel) + '</span></td>' +
          '<td class="sub">' + esc(u.department || '—') + '</td>' +
          '<td>' + state + '</td>' +
          '<td class="sub">' + (u.lastLogin ? fmtDateTime(u.lastLogin) : 'never') + '</td>' +
          '<td><div class="row-actions">' +
          (isPending ? '<button class="btn sm primary" onclick="approveUser(\'' + esc(u.email) + '\')">Approve</button>' : '') +
          (u.locked ? '<button class="btn sm" onclick="unlockUser(\'' + esc(u.email) + '\')">Unlock</button>' : '') +
          '<button class="btn sm" onclick="openUserForm(\'' + esc(u.email) + '\')">Edit</button>' +
          '<button class="btn sm" onclick="resetPassword(\'' + esc(u.email) + '\')">Reset password</button>' +
          '<button class="btn sm ghost" onclick="revoke(\'' + esc(u.email) + '\')">Sign out</button>' +
          '<button class="btn sm ghost" onclick="removeUser(\'' + esc(u.email) + '\')">Remove</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>');
  }).catch(fail);
}

function openUserForm(email) {
  const u = email ? S.users.filter(function (x) { return x.email === email; })[0] : null;
  const roles = Object.keys(BOOT.roles).filter(function (r) { return ['ADMIN', 'STAFF', 'STUDENT', 'AUDITOR'].indexOf(r) >= 0; });
  showModal(u ? 'Edit ' + u.name : 'Add a person',
    '<div class="grid2">' +
    '<div class="field"><label for="p_email">Email</label><input id="p_email" value="' + esc(u ? u.email : '') + '"' + (u ? ' readonly' : '') + '></div>' +
    '<div class="field"><label for="p_name">Full name</label><input id="p_name" value="' + esc(u ? u.name : '') + '"></div>' +
    '</div>' +
    '<div class="grid3">' +
    '<div class="field"><label for="p_role">Role</label><select id="p_role">' +
    roles.map(function (r) {
      return '<option value="' + r + '"' + (u && u.role === r ? ' selected' : '') + '>' + esc(BOOT.roles[r]) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field"><label for="p_dept">Department</label><input id="p_dept" value="' + esc(u ? u.department : '') + '"></div>' +
    '<div class="field"><label for="p_status">Status</label><select id="p_status">' +
    ['ACTIVE', 'PENDING', 'SUSPENDED'].map(function (s) {
      return '<option' + (u && String(u.status).toUpperCase() === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('') + '</select></div></div>' +
    '<div class="field"><label for="p_phone">Phone</label><input id="p_phone" value="' + esc(u ? u.phone : '') + '"></div>' +
    '<p class="hint">Administrators manage everything. Laboratory staff hold stock and approve requests. ' +
    'Students and researchers request and log their own use. Auditors read everything and change nothing.</p>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="saveUser(this)">Save person</button>');
}

function saveUser(btn) {
  setBusy(btn, true, 'Saving…');
  api('saveUser', {
    email: val('p_email'), name: val('p_name'), role: val('p_role'),
    department: val('p_dept'), phone: val('p_phone'), status: val('p_status')
  }).then(function (msg) { closeLayer(); toast(msg); go('people'); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function approveUser(email) {
  const u = S.users.filter(function (x) { return x.email === email; })[0];
  api('saveUser', {
    email: email, name: u.name, role: u.role, department: u.department,
    phone: u.phone, status: 'ACTIVE'
  }).then(function () { toast(email + ' approved.'); go('people'); }).catch(fail);
}

function resetPassword(email) {
  showModal('Reset the password for ' + email + '?',
    '<p>A temporary password is generated and emailed. They will be asked to set their own on the next sign-in, ' +
    'and any device currently signed in as them is signed out.</p>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="doReset(\'' + esc(email) + '\',this)">Reset password</button>');
}

function doReset(email, btn) {
  setBusy(btn, true, 'Resetting…');
  api('adminResetPassword', email).then(function (res) {
    showModal('Temporary password',
      '<p>Read this to ' + esc(email) + ' or let them use the emailed copy. It is shown once.</p>' +
      '<p class="mono" style="font-size:22px;font-weight:700;letter-spacing:.04em">' + esc(res.temp) + '</p>',
      '<button class="btn primary" onclick="closeLayer();go(\'people\')">Done</button>');
  }).catch(function (e) { setBusy(btn, false); fail(e); });
}

function unlockUser(email) {
  api('unlockAccount', email).then(function (msg) { toast(msg); go('people'); }).catch(fail);
}

function revoke(email) {
  api('revokeSessions', email).then(function (msg) { toast(msg); go('people'); }).catch(fail);
}

function removeUser(email) {
  showModal('Remove ' + email + '?',
    '<p>The account loses access immediately. Everything they logged stays in the usage history and audit trail.</p>',
    '<button class="btn" onclick="closeLayer()">Keep account</button>' +
    '<button class="btn danger" onclick="api(\'deleteUser\',\'' + esc(email) + '\').then(function(m){closeLayer();toast(m);go(\'people\')}).catch(fail)">Remove access</button>');
}

/* =================================================================
 * AUDIT TRAIL
 * ================================================================= */

function viewAudit() {
  api('getAuditTrail', 400).then(function (rows) {
    setActions(can('export') ? '<button class="btn" onclick="download(\'audit\')">Export CSV</button>' : '');
    setSub('Last ' + rows.length + ' recorded actions');
    paint('<div class="panel"><div class="scroll"><table class="data"><thead><tr>' +
      '<th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>' +
      rows.map(function (a) {
        return '<tr><td class="sub">' + fmtDateTime(a.timestamp) + '</td>' +
          '<td class="sub">' + esc(a.user) + '<div class="sub">' + esc(a.role) + '</div></td>' +
          '<td><span class="mono">' + esc(a.action) + '</span></td>' +
          '<td class="sub mono">' + esc(a.entity) + (a.entityId ? ' ' + esc(a.entityId) : '') + '</td>' +
          '<td class="sub" style="max-width:340px;overflow:hidden;text-overflow:ellipsis">' + esc(a.details) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>');
  }).catch(fail);
}

/* =================================================================
 * SETTINGS
 * ================================================================= */

function viewSettings() {
  Promise.all([api('getSettings'), loadLocations(true), api('listTriggers')]).then(function (r) {
    const settings = r[0], triggers = r[2];
    setSub('Configuration, storage locations and scheduled jobs');

    const fields = settings.map(function (s) {
      return '<div class="field"><label for="cfg_' + s.key + '">' + esc(s.description || s.key) + '</label>' +
        '<input id="cfg_' + s.key + '" data-key="' + s.key + '" value="' + esc(s.value) + '">' +
        '<div class="hint mono">' + s.key + '</div></div>';
    }).join('');

    const locRows = S.locations.map(function (l) {
      return '<tr><td>' + esc(l.path) + (l.shelf ? '<div class="sub">' + esc(l.shelf) + '</div>' : '') + '</td>' +
        '<td class="sub">' + esc(l.storageClass) + '</td>' +
        '<td><div class="row-actions"><button class="btn sm" onclick="openLocationForm(\'' + l.id + '\')">Edit</button>' +
        '<button class="btn sm ghost" onclick="api(\'deleteLocation\',\'' + l.id + '\').then(function(m){toast(m);go(\'settings\')}).catch(fail)">Remove</button></div></td></tr>';
    }).join('');

    paint('<div class="cols">' +
      '<div class="stack">' +
      '<div class="panel"><h3>Configuration</h3><div class="body">' + fields +
      '<button class="btn primary" onclick="saveConfig(this)">Save configuration</button></div></div>' +
      '<div class="panel"><h3>Storage locations</h3><div class="body">' +
      '<table class="data"><thead><tr><th>Location</th><th>Class</th><th></th></tr></thead><tbody>' +
      (locRows || '<tr><td colspan="3" class="sub">None yet.</td></tr>') + '</tbody></table>' +
      '<button class="btn" style="margin-top:12px" onclick="openLocationForm()">Add location</button>' +
      '</div></div></div>' +

      '<div class="stack">' +
      '<div class="panel"><h3>Scheduled jobs</h3><div class="body">' +
      (triggers.length
        ? '<ul style="margin:0 0 12px;padding-left:18px">' + triggers.map(function (t) {
          return '<li><span class="mono">' + esc(t.handler) + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="sub">No scheduled jobs are installed.</p>') +
      '<div class="row-actions">' +
      '<button class="btn primary" onclick="api(\'sendAlertsNow\').then(function(m){toast(m)}).catch(fail)">Send the digest now</button>' +
      '<button class="btn" onclick="api(\'installSchedules\').then(function(m){toast(m);go(\'settings\')}).catch(fail)">Reinstall schedules</button>' +
      '</div>' +
      '<p class="hint">The daily digest lists expired, expiring and low-stock chemicals. ' +
      'The Monday summary sends compliance figures to administrators and auditors.</p>' +
      '</div></div>' +
      '<div class="panel"><h3>Who can do what</h3><div class="body">' + permissionTable() + '</div></div>' +
      '</div></div>');
  }).catch(fail);
}

function permissionTable() {
  const rows = [
    ['View chemicals and sheets', 'Everyone'],
    ['Request a chemical', 'Students, researchers, staff'],
    ['Approve and reject requests', 'Staff, administrators'],
    ['Issue stock and record receipts', 'Staff, administrators'],
    ['Log own usage and returns', 'Everyone except auditors'],
    ['Add or edit chemical records', 'Staff, administrators'],
    ['Upload safety data sheets', 'Staff, administrators'],
    ['Print QR labels', 'Staff, administrators'],
    ['Read the audit trail', 'Auditors, administrators'],
    ['Manage people and settings', 'Administrators']
  ];
  return '<table class="data"><tbody>' + rows.map(function (r) {
    return '<tr><td>' + r[0] + '</td><td class="sub">' + r[1] + '</td></tr>';
  }).join('') + '</tbody></table>';
}

function saveConfig(btn) {
  const map = {};
  document.querySelectorAll('[data-key]').forEach(function (i) { map[i.dataset.key] = i.value; });
  setBusy(btn, true, 'Saving…');
  api('saveSettings', map).then(function (msg) {
    setBusy(btn, false); toast(msg);
    document.getElementById('orgName').textContent = map.ORG_NAME || 'Laboratory';
  }).catch(function (e) { setBusy(btn, false); fail(e); });
}

function openLocationForm(id) {
  const l = id ? S.locations.filter(function (x) { return x.id === id; })[0] : null;
  showModal(l ? 'Edit location' : 'Add a storage location',
    '<div class="grid2">' +
    '<div class="field"><label for="l_building">Building</label><input id="l_building" value="' + esc(l ? l.building : '') + '"></div>' +
    '<div class="field"><label for="l_room">Room</label><input id="l_room" value="' + esc(l ? l.room : '') + '"></div>' +
    '<div class="field"><label for="l_cabinet">Cabinet</label><input id="l_cabinet" value="' + esc(l ? l.cabinet : '') + '"></div>' +
    '<div class="field"><label for="l_shelf">Shelf</label><input id="l_shelf" value="' + esc(l ? l.shelf : '') + '"></div>' +
    '</div>' +
    '<div class="field"><label for="l_class">Storage class</label><select id="l_class">' +
    STORAGE_CLASSES.map(function (s) {
      return '<option' + (l && l.storageClass === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field"><label for="l_notes">Notes</label><input id="l_notes" value="' + esc(l ? l.notes : '') + '"></div>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="saveLocation(' + (id ? "'" + id + "'" : 'null') + ',this)">Save location</button>');
}

function saveLocation(id, btn) {
  setBusy(btn, true, 'Saving…');
  api('saveLocation', {
    id: id, building: val('l_building'), room: val('l_room'), cabinet: val('l_cabinet'),
    shelf: val('l_shelf'), storageClass: val('l_class'), notes: val('l_notes')
  }).then(function (msg) { closeLayer(); toast(msg); S.loaded.loc = false; go('settings'); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

/* =================================================================
 * EXPORT
 * ================================================================= */

function download(what) {
  toast('Preparing the file…');
  api('exportCsv', what).then(function (res) {
    const blob = new Blob([res.content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }).catch(fail);
}

/* =================================================================
 * START
 * ================================================================= */

/* =================================================================
 * SIGN IN / REGISTER
 * ================================================================= */

let AUTH_TAB = 'signin';

function renderLogin(message) {
  document.getElementById('shell').classList.add('anon');
  document.getElementById('layer').innerHTML = '';
  document.getElementById('auth').style.display = 'flex';
  document.getElementById('auth').innerHTML =
    '<div class="authcard">' +
    '<div class="authhead">' +
    '<svg class="flask" viewBox="0 0 24 24" fill="none" stroke="#0e7c86" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 2h6M10 2v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 8.5V2"/><path d="M7.2 14.5h9.6"/></svg>' +
    '<div><b>LabChem</b><small>' + esc(BOOT.app.org) + '</small></div></div>' +

    (BOOT.registrationOpen
      ? '<div class="authtabs">' +
        '<button class="' + (AUTH_TAB === 'signin' ? 'on' : '') + '" onclick="AUTH_TAB=\'signin\';renderLogin()">Sign in</button>' +
        '<button class="' + (AUTH_TAB === 'register' ? 'on' : '') + '" onclick="AUTH_TAB=\'register\';renderLogin()">Create an account</button>' +
        '</div>'
      : '') +

    (message ? '<p class="authnote">' + esc(message) + '</p>' : '') +
    (AUTH_TAB === 'signin' ? signinForm() : registerForm()) +
    '</div>';

  const first = document.querySelector('#auth input');
  if (first) first.focus();
}

function signinForm() {
  return '<div class="field"><label for="a_email">Email address</label>' +
    '<input id="a_email" type="email" autocomplete="username" onkeydown="if(event.key===\'Enter\')doLogin(document.getElementById(\'a_go\'))"></div>' +
    '<div class="field"><label for="a_pass">Password</label>' +
    '<input id="a_pass" type="password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')doLogin(document.getElementById(\'a_go\'))"></div>' +
    '<button class="btn primary wide" id="a_go" onclick="doLogin(this)">Sign in</button>' +
    '<button class="btn ghost wide" onclick="openForgot()">Forgotten password</button>';
}

function registerForm() {
  const domains = BOOT.allowedDomains
    ? 'Use your institution address: ' + esc(BOOT.allowedDomains.split(',').map(function (d) { return '@' + d.trim(); }).join(', '))
    : 'Students and researchers register here. An administrator approves the account before it opens.';
  return '<p class="authnote">' + domains + '</p>' +
    '<div class="field"><label for="g_name">Full name</label><input id="g_name" autocomplete="name"></div>' +
    '<div class="field"><label for="g_email">Email address</label><input id="g_email" type="email" autocomplete="username"></div>' +
    '<div class="grid2">' +
    '<div class="field"><label for="g_dept">Department or research group</label><input id="g_dept"></div>' +
    '<div class="field"><label for="g_phone">Phone (optional)</label><input id="g_phone"></div></div>' +
    '<div class="field"><label for="g_pass">Password</label>' +
    '<input id="g_pass" type="password" autocomplete="new-password"></div>' +
    '<div class="field"><label for="g_pass2">Repeat password</label>' +
    '<input id="g_pass2" type="password" autocomplete="new-password"></div>' +
    '<p class="hint">At least 10 characters, with a letter and a number.</p>' +
    '<button class="btn primary wide" onclick="doRegister(this)">Create account</button>';
}

function doLogin(btn) {
  const email = val('a_email'), pass = val('a_pass');
  if (!email || !pass) return fail(new Error('Enter your email address and password.'));
  setBusy(btn, true, 'Signing in…');
  pub('login', email, pass, navigator.userAgent)
    .then(function (payload) { startSession(payload); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function doRegister(btn) {
  setBusy(btn, true, 'Creating…');
  pub('registerAccount', {
    name: val('g_name'), email: val('g_email'), department: val('g_dept'),
    phone: val('g_phone'), password: val('g_pass'), confirm: val('g_pass2')
  }).then(function (msg) {
    AUTH_TAB = 'signin';
    renderLogin(msg);
  }).catch(function (e) { setBusy(btn, false); fail(e); });
}

function openForgot() {
  showModal('Forgotten password',
    '<p class="sub">We will email a temporary password. Change it as soon as you are back in.</p>' +
    '<div class="field"><label for="f_email">Email address</label><input id="f_email" type="email"></div>',
    '<button class="btn" onclick="closeLayer()">Cancel</button>' +
    '<button class="btn primary" onclick="sendForgot(this)">Email a temporary password</button>');
}

function sendForgot(btn) {
  setBusy(btn, true, 'Sending…');
  pub('requestPasswordReset', val('f_email'))
    .then(function (msg) { closeLayer(); toast(msg); })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

function signOut() {
  const t = TOKEN;
  writeToken(null);
  BOOT.permissions = [];
  pub('logout', t).catch(function () { /* the token is gone locally regardless */ });
  S.loaded = {}; S.chemicals = []; S.dash = null;
  document.getElementById('nav').innerHTML = '';
  paint('');
  AUTH_TAB = 'signin';
  renderLogin('Signed out.');
}

/* ---------- forced and voluntary password change ---------- */

function openPasswordChange(forced) {
  showModal(forced ? 'Set your own password' : 'Change password',
    (forced ? '<p class="sub">You signed in with a temporary password. Choose your own before continuing.</p>' : '') +
    '<div class="field"><label for="c_old">Current password</label><input id="c_old" type="password" autocomplete="current-password"></div>' +
    '<div class="field"><label for="c_new">New password</label><input id="c_new" type="password" autocomplete="new-password"></div>' +
    '<div class="field"><label for="c_new2">Repeat new password</label><input id="c_new2" type="password" autocomplete="new-password"></div>' +
    '<p class="hint">At least 10 characters, with a letter and a number. Other devices signed in as you will be signed out.</p>',
    (forced ? '' : '<button class="btn" onclick="closeLayer()">Cancel</button>') +
    '<button class="btn primary" onclick="doPasswordChange(this,' + (forced ? 'true' : 'false') + ')">Save password</button>');
}

function doPasswordChange(btn, forced) {
  setBusy(btn, true, 'Saving…');
  api('changePassword', val('c_old'), val('c_new'), val('c_new2'))
    .then(function (msg) {
      closeLayer(); toast(msg);
      BOOT.user.mustChangePassword = false;
      if (forced) launchApp();
    })
    .catch(function (e) { setBusy(btn, false); fail(e); });
}

/* =================================================================
 * START
 * ================================================================= */

function startSession(payload) {
  writeToken(payload.token);
  BOOT.user = payload.user;
  BOOT.permissions = payload.permissions;
  BOOT.roles = payload.roles;
  BOOT.expiryWindow = payload.expiryWindow;
  BOOT.app.org = payload.org;

  document.getElementById('auth').style.display = 'none';
  document.getElementById('shell').classList.remove('anon');
  document.getElementById('orgName').textContent = payload.org;
  document.getElementById('userName').textContent = payload.user.name;
  document.getElementById('userRole').textContent = payload.user.roleLabel;
  document.getElementById('userEmail').textContent = payload.user.email;

  if (payload.user.mustChangePassword) { openPasswordChange(true); return; }
  launchApp();
}

function launchApp() {
  const first = visibleViews()[0];
  S.view = first ? first.id : 'dashboard';

  api('getDashboard').then(function (d) { S.dash = d; renderNav(); }).catch(function () { renderNav(); });

  if (BOOT.deepLink) {
    const target = BOOT.deepLink;
    BOOT.deepLink = '';
    go('inventory');
    loadChemicals().then(function () { openChemical(target); });
  } else {
    go(S.view);
  }
}

function readDeepLink() {
  const m = location.search.match(/[?&]chem=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const SETUP_STEPS = [
  'In Apps Script: <b>Deploy → New deployment → Web app</b>, with <b>Execute as: Me</b> and ' +
  '<b>Who has access: Anyone</b>. Anything stricter blocks this page.',
  'Copy the <b>Web app URL</b>. It ends in <code>/exec</code>, not <code>/dev</code>.',
  'Paste it into <code>config.js</code> in your repository, as the value of <code>apiUrl</code>.',
  'Commit, wait for the Pages build to finish (repository → Actions tab), then reload.'
];

(function start() {
  if (!stylesLoaded()) {
    showFatal('The stylesheet did not load',
      'index.html found no assets/styles.css, so the page is unstyled and the app cannot start cleanly.', [
        'Check the repository has <code>assets/styles.css</code> and <code>assets/app.js</code> ' +
        'in an <b>assets</b> folder beside <code>index.html</code>.',
        'Names are case sensitive on GitHub Pages: <code>assets</code>, not <code>Assets</code>.',
        'If you renamed the repository, reload with a hard refresh to clear the cached page.'
      ]);
    return;
  }

  const problem = configProblem();
  if (problem) {
    showFatal('Setup needed', problem, SETUP_STEPS);
    return;
  }

  BOOT.deepLink = readDeepLink();

  pub('getPublicConfig').then(function (cfg) {
    BOOT.app = cfg.app;
    BOOT.registrationOpen = cfg.registrationOpen;
    BOOT.allowedDomains = cfg.allowedDomains;
    document.getElementById('orgName').textContent = cfg.app.org;
    document.title = cfg.app.org + ' — LabChem';

    TOKEN = readToken();
    if (!TOKEN) { renderLogin(); return; }

    return pub('resumeSession', TOKEN).then(function (payload) {
      if (!payload) { writeToken(null); renderLogin(); return; }
      startSession(payload);
    }).catch(function () { writeToken(null); renderLogin(); });

  }).catch(function (err) {
    showFatal('Cannot reach the server', err.message, SETUP_STEPS);
  });
})();
