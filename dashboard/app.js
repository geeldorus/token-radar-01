/* Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
   Sortable and filterable board, a detail view per protocol, and the live-token table.
   State lives in the URL hash: #p=<slug> opens a detail, #f=<category> filters by category. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<p class="empty">No radar data loaded.</p>';
    return;
  }
  var rows = R.rows;
  var watch = new Set(R.watchlist || []);
  // The watchlist slugs are not in the data file; the board marks them from board.json's
  // rank set instead — main.ts writes watchlist slugs into R.watchlist. Fall back gracefully.
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var qEl = $('q'), catEl = $('cat'), chainEl = $('chain'), sortEl = $('sort'),
      watchEl = $('watch'), countEl = $('count'), tbody = $('rows');

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- stats -------------------------------------------------------------
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var top = rows[0];
  $('stats').innerHTML =
    '<div><dt>Protocols ranked</dt><dd>' + rows.length + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + R.watchlist_size + ' / ' + R.watchlist_size + '</dd></div>' +
    '<div><dt>Top implied value</dt><dd>' + money(top.implied_value_usd) + '</dd></div>' +
    '<div><dt>Board total</dt><dd>' + money(totalImplied) + '</dd></div>';
  $('source-line').textContent = 'Snapshot ' + R.as_of + ' · ' + R.source +
    ' · floor $' + (R.floor_usd / 1e6) + 'M TVL · model ' + R.model_version +
    ' · ' + R.board_size + ' rows (' + R.early_size + ' beyond the watchlist), ' + R.live_size + ' live tokens set aside.';

  // ---- filter options ----------------------------------------------------
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { catEl.add(new Option(c, c)); });
  chains.forEach(function (c) { chainEl.add(new Option(c, c)); });

  // ---- sorting -----------------------------------------------------------
  var sortKey = 'rank';
  var sortDir = 1;
  var SORTERS = {
    rank: function (a, b) { return (a.rank - b.rank) * sortDir; },
    tvl: function (a, b) { return (b.tvl_usd - a.tvl_usd) * sortDir; },
    growth: function (a, b) { return ((b.change_7d || 0) - (a.change_7d || 0)) * sortDir; },
    age: function (a, b) { return ((b.age_days || 0) - (a.age_days || 0)) * sortDir; },
    name: function (a, b) { return (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) * sortDir; },
    value: function (a, b) { return (b.implied_value_usd - a.implied_value_usd) * sortDir; },
    category: function (a, b) { return ((a.category || '') < (b.category || '') ? -1 : 1) * sortDir; },
    chains: function (a, b) { return ((b.chains || []).length - (a.chains || []).length) * sortDir; }
  };

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value, chain = chainEl.value, onlyWatch = watchEl.checked;
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (r.chains || []).indexOf(chain) < 0) return false;
      if (onlyWatch && !watch.has(r.slug)) return false;
      return true;
    });
  }

  function render() {
    var list = filtered().slice().sort(SORTERS[sortKey] || SORTERS.rank);
    countEl.textContent = list.length + ' of ' + rows.length + ' protocols' +
      (list.length !== rows.length ? ' match the filter' : '') + ' · sorted by ' + sortEl.value;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Nothing matches this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (r) {
      var age = r.age_days === null || r.age_days === undefined ? '—' : r.age_days + 'd';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><span class="sub">' + esc(r.slug) +
        (watch.has(r.slug) ? ' · <span class="pill">watchlist</span>' : '') + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td></tr>';
    }).join('');
    document.querySelectorAll('#board thead th').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-k') === sortKey ||
        (sortKey === 'value' && th.getAttribute('data-k') === 'value') ||
        (sortKey === 'rank' && th.getAttribute('data-k') === 'rank'));
    });
  }

  // ---- detail view -------------------------------------------------------
  var detailEl = $('detail');
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) { detailEl.hidden = true; return; }
    document.querySelectorAll('#rows tr.sel').forEach(function (tr) { tr.classList.remove('sel'); });
    var tr = tbody.querySelector('tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('sel');
    $('d-name').textContent = '#' + r.rank + ' ' + r.name;
    var age = r.age_days === null || r.age_days === undefined ? 'unknown' : r.age_days + ' days';
    var shownChains = (r.chains || []).slice(0, 6);
    var chainText = shownChains.join(', ') +
      ((r.chains || []).length > 6 ? ' and ' + ((r.chains || []).length - 6) + ' more' : '');
    $('d-grid').innerHTML =
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day growth</dt><dd>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(chainText || '—') + '</dd></div>' +
      '<div><dt>Age with no token</dt><dd>' + age + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(r.listed_at || '—') + '</dd></div>' +
      '<div><dt>Status</dt><dd>Records no token</dd></div>';
    $('d-model').textContent =
      'TVL ' + money(r.tvl_usd) + ' × category ' + r.category_multiple.toFixed(2) +
      ' × growth ' + r.growth_multiplier.toFixed(2) +
      ' × maturity ' + r.maturity_multiplier.toFixed(2) +
      ' × breadth ' + r.breadth_multiplier.toFixed(2) +
      ' = ' + money(r.implied_value_usd) + ' implied value.';
    $('d-steps').innerHTML = (r.farm_steps || []).map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    detailEl.hidden = false;
    detailEl.scrollIntoView({ block: 'nearest' });
  }
  function closeDetail() {
    detailEl.hidden = true;
    document.querySelectorAll('#rows tr.sel').forEach(function (tr) { tr.classList.remove('sel'); });
    if (location.hash.indexOf('#p=') === 0) history.replaceState(null, '', location.pathname + location.search);
  }
  $('d-close').addEventListener('click', closeDetail);
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    history.replaceState(null, '', '#p=' + tr.getAttribute('data-slug'));
    openDetail(tr.getAttribute('data-slug'));
  });

  // ---- live table --------------------------------------------------------
  $('live-rows').innerHTML = (R.live || []).map(function (p) {
    return '<tr><td><strong>' + esc(p.name) + '</strong><span class="sub">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num"><strong>' + money(p.mcap_usd) + '</strong></td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- events ------------------------------------------------------------
  [qEl, catEl, chainEl, watchEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  sortEl.addEventListener('change', function () { sortKey = sortEl.value; sortDir = 1; render(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = 1; }
      sortEl.value = SORTERS[sortKey] ? k : 'rank';
      render();
    });
  });
  $('reset').addEventListener('click', function () {
    qEl.value = ''; catEl.value = ''; chainEl.value = ''; watchEl.checked = false;
    sortKey = 'rank'; sortDir = 1; sortEl.value = 'rank';
    history.replaceState(null, '', location.pathname + location.search);
    closeDetail(); render();
  });

  // ---- hash state: #p=<slug> detail, #f=<category> filtered view --------
  function applyHash() {
    var h = location.hash.slice(1);
    var m = h.match(/(?:^|&)p=([^&]+)/);
    var f = h.match(/(?:^|&)f=([^&]+)/);
    if (f) {
      var cat = decodeURIComponent(f[1]);
      if (cats.indexOf(cat) >= 0) catEl.value = cat;
    }
    render();
    if (m) openDetail(decodeURIComponent(m[1]));
  }
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
