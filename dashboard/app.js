// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board with search, category and chain filters and five sort orders, a per-protocol
// detail view with the model's factor breakdown and the protocol's farm plan, a reference view of
// protocols whose tokens already trade, and a page that states the model itself. No network:
// every byte it shows arrives in data.js, generated from the same board board.json carries.
(function () {
  'use strict';

  var R = window.RADAR;
  if (!R) return;
  var rows = R.rows;
  var bySlug = new Map();
  rows.forEach(function (r) { bySlug.set(r.slug, r); });

  var state = { q: '', category: '', chain: '', watch: false, sort: 'implied', view: 'board', slug: null };

  // ---- formatting -----------------------------------------------------------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function fmtFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365.25).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.44) + 'mo';
    return days + 'd';
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function td(cls, text) { return el('td', cls, text); }

  // ---- chrome ---------------------------------------------------------------
  document.getElementById('snapshot-note').textContent =
    'DefiLlama protocols snapshot · as of ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked';
  document.getElementById('foot-note').textContent =
    'Model ' + R.model_version + ' · Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token will be issued.';

  // ---- stats ----------------------------------------------------------------
  function renderStats() {
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var covered = rows.filter(function (r) { return r.watchlist; }).length;
    var box = document.getElementById('stats');
    box.textContent = '';
    [
      [String(R.board_size), 'protocols ranked', false],
      [covered + ' / ' + R.watchlist_size, 'watchlist covered', true],
      [fmtUsd(total), 'combined implied value', false],
      [fmtUsd(rows[0].implied_value_usd), 'top implied value', false],
      [String(R.live_size), 'already trading, set aside', false]
    ].forEach(function (s) {
      var d = el('div', 'stat' + (s[2] ? ' hot' : ''));
      d.appendChild(el('b', null, s[0]));
      d.appendChild(el('span', null, s[1]));
      box.appendChild(d);
    });
  }

  // ---- filters --------------------------------------------------------------
  function fillSelect(select, values, allLabel) {
    select.textContent = '';
    var all = el('option', null, allLabel);
    all.value = '';
    select.appendChild(all);
    values.forEach(function (v) {
      var o = el('option', null, v);
      o.value = v;
      select.appendChild(o);
    });
  }
  function buildControls() {
    var cats = new Map();
    var chains = new Set();
    rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      cats.set(c, (cats.get(c) || 0) + 1);
      r.chains.forEach(function (ch) { chains.add(ch); });
    });
    var catList = Array.from(cats.entries()).sort(function (a, b) { return b[1] - a[1]; })
      .map(function (e) { return e[0]; });
    fillSelect(document.getElementById('f-category'), catList, 'All categories');
    fillSelect(document.getElementById('f-chain'), Array.from(chains).sort(), 'All chains');

    document.getElementById('f-search').addEventListener('input', function (e) {
      state.q = e.target.value.trim().toLowerCase(); renderBoard();
    });
    document.getElementById('f-category').addEventListener('change', function (e) {
      state.category = e.target.value; renderBoard();
    });
    document.getElementById('f-chain').addEventListener('change', function (e) {
      state.chain = e.target.value; renderBoard();
    });
    document.getElementById('f-sort').addEventListener('change', function (e) {
      state.sort = e.target.value; renderBoard();
    });
    document.getElementById('f-watch').addEventListener('change', function (e) {
      state.watch = e.target.checked; renderBoard();
    });
  }

  function visibleRows() {
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.q && r.name.toLowerCase().indexOf(state.q) === -1 && r.slug.indexOf(state.q) === -1) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      name: function (r) { return r.name; }
    }[state.sort];
    list.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      if (ka < kb) return state.sort === 'name' ? -1 : 1;
      if (ka > kb) return state.sort === 'name' ? 1 : -1;
      return a.rank - b.rank;
    });
    return list;
  }

  // ---- board ----------------------------------------------------------------
  function renderBoard() {
    var list = visibleRows();
    document.getElementById('count').textContent = 'showing ' + list.length + ' of ' + rows.length;
    var body = document.getElementById('board-body');
    body.textContent = '';
    if (list.length === 0) {
      var tr = el('tr');
      var cell = td('empty', 'No protocol matches these filters.');
      cell.colSpan = 8;
      tr.appendChild(cell);
      body.appendChild(tr);
      return;
    }
    list.forEach(function (r) {
      var tr = el('tr');
      tr.addEventListener('click', function () { location.hash = '#p/' + r.slug; });

      tr.appendChild(td('num rank', '#' + r.rank));
      var nameCell = td(null);
      nameCell.appendChild(el('span', 'pname', r.name));
      nameCell.appendChild(el('span', 'pslug', r.slug));
      if (r.watchlist) nameCell.appendChild(el('span', 'wl', 'WL'));
      tr.appendChild(nameCell);
      tr.appendChild(td('cat', r.category || 'Uncategorised'));
      var chainCell = td('chains', r.chains.slice(0, 2).join(', '));
      if (r.chains.length > 2) chainCell.appendChild(el('span', 'more', ' +' + (r.chains.length - 2)));
      tr.appendChild(chainCell);
      tr.appendChild(td('num', fmtUsd(r.tvl_usd)));
      var chCell = td('num', fmtPct(r.change_7d));
      if (r.change_7d !== null) chCell.classList.add(r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat');
      tr.appendChild(chCell);
      tr.appendChild(td('num', fmtAge(r.age_days)));
      tr.appendChild(td('num implied', fmtUsd(r.implied_value_usd)));
      body.appendChild(tr);
    });
  }

  // ---- live reference ---------------------------------------------------------
  function renderLive() {
    document.getElementById('live-note').textContent =
      'These protocols already have a token trading, so they are not ranked: the market has priced them. ' +
      'They are shown because their market-cap-to-TVL ratios are the peer evidence the model prices the board with.';
    var body = document.getElementById('live-body');
    body.textContent = '';
    R.live.forEach(function (r) {
      var tr = el('tr');
      tr.style.cursor = 'default';
      var nameCell = td(null);
      nameCell.appendChild(el('span', 'pname', r.name));
      nameCell.appendChild(el('span', 'pslug', r.slug));
      tr.appendChild(nameCell);
      tr.appendChild(td('cat', r.symbol || '—'));
      tr.appendChild(td('cat', r.category || 'Uncategorised'));
      tr.appendChild(td('num', fmtUsd(r.tvl_usd)));
      tr.appendChild(td('num', fmtUsd(r.mcap_usd)));
      var chCell = td('num', fmtPct(r.change_7d));
      if (r.change_7d !== null) chCell.classList.add(r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat');
      tr.appendChild(chCell);
      body.appendChild(tr);
    });
  }

  // ---- model page -------------------------------------------------------------
  function renderModel() {
    var m = R.model;
    var box = document.getElementById('model-body');
    box.textContent = '';
    box.appendChild(el('h2', null, 'How this radar prices a launch'));
    box.appendChild(el('p', null,
      'Every protocol on the board records no token in the snapshot: no market cap, no CoinGecko id, no symbol. ' +
      'The board is the watchlist\u2019s own exclusion rule with its $50M TVL floor removed — wrapped, staked and bridged ' +
      'pass-throughs, exchange products and single-version pools stay out — which ranks ' + R.board_size +
      ' protocols and covers all ' + R.watchlist_size + ' watchlist names. One function prices every row; no name is special-cased.'));
    var f = el('p', 'formula', 'implied value  =  TVL  \u00d7  peer multiple (category)  \u00d7  momentum factor  \u00d7  maturity factor  \u00d7  reach factor');
    box.appendChild(f);

    box.appendChild(el('h3', null, 'Peer multiple — what the market pays per TVL dollar'));
    box.appendChild(el('p', null,
      'For each category, take the snapshot\u2019s already-tokened protocols in it and the median of their market-cap-to-TVL ' +
      'ratios. Shrink that median toward the market-wide median (' + R.global_median.toFixed(3) + ') by sample size — ' +
      '(n \u00d7 category median + ' + m.shrink_weight + ' \u00d7 global median) / (n + ' + m.shrink_weight + ') — and clamp to [' +
      m.multiple_floor + ', ' + m.multiple_cap + '], so a category with one eccentric peer cannot dominate. ' +
      'A category with no tokened peers is priced at the global median. Each protocol\u2019s detail view shows its own multiple and peer count.'));

    box.appendChild(el('h3', null, 'Momentum factor — is the TVL arriving or leaving'));
    box.appendChild(el('p', null,
      'The seven-day TVL change, clamped to [' + m.momentum_floor_pct + '%, +' + m.momentum_cap_pct + '%] and scaled by ' +
      m.momentum_weight + ': factor = 1 + clamped change / 100 \u00d7 ' + m.momentum_weight + '. A protocol growing into its launch ' +
      'is priced above one bleeding TVL; an unreported change is neutral.'));

    box.appendChild(el('h3', null, 'Maturity factor — how long it has run with no token'));
    box.appendChild(el('p', null,
      'Days from the protocol\u2019s listing date to the snapshot date, mapped linearly from ' + m.maturity_base + ' to ' +
      (m.maturity_base + m.maturity_span).toFixed(2) + ' over ' + m.maturity_days + ' days. A long tokenless track record is evidence ' +
      'of a real, durable protocol whose launch is still ahead of it. An unknown listing date counts as ' + m.unknown_age_days + ' days.'));

    box.appendChild(el('h3', null, 'Reach factor — how many chains it is live on'));
    box.appendChild(el('p', null,
      'The number of chains in the protocol\u2019s own record: factor = 1 + ' + m.reach_per_chain + ' \u00d7 extra chains, counting at most ' +
      m.reach_max_extra_chains + ' extra, so a single-chain protocol scores \u00d71.00 and one live on eleven or more chains scores \u00d7' +
      (1 + m.reach_per_chain * m.reach_max_extra_chains).toFixed(2) + '. Every extra chain is another surface a farmer can qualify on ' +
      'and another community a launch would be distributed into, so breadth earns a bounded premium rather than none.'));

    box.appendChild(el('h3', null, 'Farm plans'));
    box.appendChild(el('p', 'note',
      'Each row\u2019s plan is generated from that protocol\u2019s own record: its category picks the core action, its first chain ' +
      'picks where gas is paid, its TVL tier sizes the suggested capital ($50\u2013$500), and its age sets the holding window ' +
      '(3\u20138 weeks). Every step states a cost and a duration.'));
    box.appendChild(el('p', 'note',
      'An implied value is this radar\u2019s claim about what a token would be worth if the protocol\u2019s record stayed as it is. ' +
      'It is not a prediction that a token will be issued, or when.'));
  }

  // ---- detail -----------------------------------------------------------------
  function factRow(table, k, v, total) {
    var tr = el('tr', total ? 'total' : null);
    tr.appendChild(td('k', k));
    tr.appendChild(td('v', v));
    table.appendChild(tr);
  }
  function renderDetail(r) {
    var box = document.getElementById('detail-body');
    box.textContent = '';

    var back = el('button', 'back', '\u2190 Back to the board');
    back.type = 'button';
    back.addEventListener('click', function () { location.hash = ''; });
    box.appendChild(back);

    var head = el('div', 'detail-head');
    head.appendChild(el('h2', null, r.name));
    head.appendChild(el('span', 'rank-badge', 'rank #' + r.rank + ' of ' + R.board_size));
    if (r.watchlist) head.appendChild(el('span', 'wl', 'WATCHLIST'));
    box.appendChild(head);
    box.appendChild(el('p', 'detail-sub',
      (r.category || 'Uncategorised') + ' · slug ' + r.slug + ' · records no token in the snapshot as of ' + R.as_of +
      ' (no market cap, no CoinGecko id, no symbol)'));

    var grid = el('div', 'detail-grid');

    var why = el('div', 'card');
    why.appendChild(el('h3', null, 'Why it ranks here — the model\u2019s working'));
    var facts = el('table', 'facts');
    factRow(facts, 'TVL (the base)', fmtFull(r.tvl_usd));
    var peerNote = r.peer_count > 0
      ? 'Peer multiple \u00d7 — ' + r.category + ': median ' + (r.category_median === null ? '—' : r.category_median.toFixed(3)) +
        ' across ' + r.peer_count + ' tokened peer' + (r.peer_count === 1 ? '' : 's') + ', shrunk toward the market median'
      : 'Peer multiple \u00d7 — no tokened peers in this category; market-wide median used';
    factRow(facts, peerNote, '\u00d7 ' + r.peer_multiple.toFixed(4));
    factRow(facts, 'Momentum \u00d7 — 7d TVL change ' + fmtPct(r.change_7d), '\u00d7 ' + r.momentum_factor.toFixed(4));
    factRow(facts, 'Maturity \u00d7 — ' + (r.age_days === null ? 'listing date unknown' : r.age_days + ' days without a token') +
      (r.listed_at ? ' (listed ' + r.listed_at + ')' : ''), '\u00d7 ' + r.maturity_factor.toFixed(4));
    factRow(facts, 'Reach \u00d7 — live on ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') +
      (r.chains.length > 0 ? ' (' + r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ', \u2026' : '') + ')' : ''), '\u00d7 ' + r.reach_factor.toFixed(4));
    factRow(facts, 'Implied value', fmtFull(r.implied_value_usd), true);
    why.appendChild(facts);
    why.appendChild(el('p', 'factor-note',
      'The same four factors price every row on the board; only the protocol\u2019s own figures change.'));
    grid.appendChild(why);

    var plan = el('div', 'card');
    plan.appendChild(el('h3', null, 'Farm plan — what to do before a launch'));
    var ol = el('ol', 'plan');
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    plan.appendChild(ol);
    grid.appendChild(plan);

    var nets = el('div', 'card');
    nets.appendChild(el('h3', null, 'Networks and record'));
    var nfacts = el('table', 'facts');
    factRow(nfacts, 'TVL', fmtFull(r.tvl_usd));
    factRow(nfacts, '7d TVL change', fmtPct(r.change_7d));
    factRow(nfacts, 'Listed since', r.listed_at || 'unknown');
    factRow(nfacts, 'Age without a token', r.age_days === null ? 'unknown' : r.age_days + ' days');
    nets.appendChild(nfacts);
    var chips = el('div', 'chain-chips');
    chips.style.marginTop = '10px';
    r.chains.forEach(function (c) { chips.appendChild(el('span', 'chip', c)); });
    nets.appendChild(chips);
    grid.appendChild(nets);

    box.appendChild(grid);
  }

  // ---- routing ------------------------------------------------------------------
  var views = { board: 'view-board', live: 'view-live', model: 'view-model', detail: 'view-detail' };
  function show(view) {
    Object.keys(views).forEach(function (k) {
      document.getElementById(views[k]).hidden = k !== view;
    });
    ['board', 'live', 'model'].forEach(function (k) {
      document.getElementById('tab-' + k).classList.toggle('is-active', k === view || (view === 'detail' && k === 'board'));
    });
    window.scrollTo(0, 0);
  }
  function route() {
    var hash = location.hash || '';
    if (hash.indexOf('#p/') === 0) {
      var r = bySlug.get(hash.slice(3));
      if (r) { renderDetail(r); show('detail'); return; }
    }
    if (hash === '#live') { show('live'); return; }
    if (hash === '#model') { show('model'); return; }
    show('board');
  }
  document.getElementById('tab-board').addEventListener('click', function () { location.hash = ''; });
  document.getElementById('tab-live').addEventListener('click', function () { location.hash = '#live'; });
  document.getElementById('tab-model').addEventListener('click', function () { location.hash = '#model'; });
  window.addEventListener('hashchange', route);

  renderStats();
  buildControls();
  renderBoard();
  renderLive();
  renderModel();
  route();
})();
