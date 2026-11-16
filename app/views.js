// The four views: board, bounty page, leaderboard, profile.
//
// Each view is an async function that renders into the #view element and
// resolves once its data has rendered (so the router can set __shotReady).
// All API answers flow through the ETag cache in api.js, so a repeat visit
// costs no bytes, and list state (filters, pages) re-renders without a
// re-fetch. Every value from the API is escaped before it reaches the DOM.

import {
  listCompetitions,
  getCompetition,
  getLeaderboard,
  getProfile,
  getProfileViews,
} from './api.js';
import {
  esc,
  fmtUsd,
  fmtInt,
  fmtBytes,
  fmtMicroPercent,
  timeLeft,
  fmtDate,
  fmtAgo,
  plural,
} from './format.js';
import { renderMarkdown } from './markdown.js';

const PAGE_SIZE_BOARD = 12;
const PAGE_SIZE_TABLE = 10;
const PAGE_SIZE_LEADERBOARD = 25;

/* ---------------- shared pieces ---------------- */

function loadingHtml(message) {
  return '<div class="loading" role="status">' + esc(message || 'Loading…') + '</div>';
}

function errorHtml(message, detail) {
  return '<div class="error"><h2>Something went wrong</h2><p>' + esc(message) + '</p>'
    + (detail ? '<p>' + esc(detail) + '</p>' : '')
    + '<button class="btn primary" data-action="retry">Try again</button></div>';
}

function emptyHtml(title, message) {
  return '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(message) + '</p></div>';
}

function pagerHtml(page, pages, total) {
  if (pages <= 1) return '';
  return '<nav class="pager" aria-label="Pages">'
    + '<button class="btn" data-action="page-prev" ' + (page <= 1 ? 'disabled' : '') + '>← Prev</button>'
    + '<span class="info">Page ' + page + ' of ' + pages + ' · ' + fmtInt(total) + ' total</span>'
    + '<button class="btn" data-action="page-next" ' + (page >= pages ? 'disabled' : '') + '>Next →</button>'
    + '</nav>';
}

function wirePager(root, state, rerender) {
  const prev = root.querySelector('[data-action="page-prev"]');
  const next = root.querySelector('[data-action="page-next"]');
  if (prev) prev.addEventListener('click', () => { if (state.page > 1) { state.page--; rerender(); } });
  if (next) next.addEventListener('click', () => { state.page++; rerender(); });
}

function wireRetry(root, rerender) {
  const btn = root.querySelector('[data-action="retry"]');
  if (btn) btn.addEventListener('click', rerender);
}

/** Confidence-interval bar: a track from 0–100%, a filled low–high range, a point marker. */
export function ciBarHtml(lowMicro, highMicro, valueMicro) {
  const low = Number(lowMicro) / 10000;
  const high = Number(highMicro) / 10000;
  const value = Number(valueMicro) / 10000;
  if (![low, high, value].every(Number.isFinite)) return '';
  const lo = Math.max(0, Math.min(100, low));
  const hi = Math.max(0, Math.min(100, high));
  const pt = Math.max(0, Math.min(100, value));
  return '<span class="ci-track ci-mini" role="img" aria-label="90% interval ' + lo.toFixed(2) + '% to ' + hi.toFixed(2) + '%">'
    + '<span class="ci-range" style="left:' + lo.toFixed(2) + '%;width:' + Math.max(0, hi - lo).toFixed(2) + '%"></span>'
    + '<span class="ci-point" style="left:' + pt.toFixed(2) + '%"></span></span>';
}

function avatarHtml(url, name) {
  const initial = esc((name || '?')[0].toUpperCase());
  if (url) {
    return '<img class="avatar" crossorigin="anonymous" src="' + esc(url) + '" alt="Avatar of ' + esc(name) + '" loading="lazy" onerror="this.remove()">';
  }
  return '<span class="avatar avatar-fallback" aria-hidden="true">' + initial + '</span>';
}

function categoryBadge(category) {
  return '<span class="badge cat-' + esc(category || 'Other') + '">' + esc(category || 'Other') + '</span>';
}

/* ---------------- board ---------------- */

const boardState = {
  items: null,
  search: '',
  category: 'All',
  status: 'open',
  sort: 'closing',
  page: 1,
};

const CATEGORIES = ['Trading', 'Forecasting', 'Security', 'Automation', 'Growth', 'Games', 'Code'];

// A profile solution's score: the API's display for a micro-unit column is
// the raw micro number (e.g. 942397 for a 94.2397% win rate), so render those
// as a percent instead of echoing the raw value.
function scoreText(score) {
  if (!score) return '—';
  const title = score.column && score.column.title ? score.column.title + ': ' : '';
  if (score.column && score.column.source && /_micro$/.test(score.column.source) && score.value != null) {
    return title + fmtMicroPercent(score.value);
  }
  if (score.display != null) return title + String(score.display);
  return title + (score.value != null ? String(score.value) : '—');
}

function boardIsOpenNow(item, now) {
  return item.status === 'open' && Date.parse(item.deadline) > now;
}

function boardFiltered(now) {
  let list = boardState.items || [];
  if (boardState.status === 'open') list = list.filter((it) => boardIsOpenNow(it, now));
  if (boardState.status === 'ended') list = list.filter((it) => !boardIsOpenNow(it, now));
  if (boardState.category !== 'All') list = list.filter((it) => it.category === boardState.category);
  const q = boardState.search.trim().toLowerCase();
  if (q) {
    list = list.filter((it) => {
      const hay = [it.title, it.slug, it.category, it.summary, (it.skills || []).join(' '), (it.sponsor && it.sponsor.name) || ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  const by = boardState.sort;
  const sorted = list.slice();
  if (by === 'closing') {
    sorted.sort((a, b) => {
      const ao = boardIsOpenNow(a, now);
      const bo = boardIsOpenNow(b, now);
      if (ao !== bo) return ao ? -1 : 1;
      const da = Date.parse(a.deadline) || 0;
      const db = Date.parse(b.deadline) || 0;
      return ao ? da - db : db - da;
    });
  } else if (by === 'pot') {
    sorted.sort((a, b) => Number(b.potUsd || 0) - Number(a.potUsd || 0));
  } else if (by === 'entries') {
    sorted.sort((a, b) => Number(b.submissionCount || 0) - Number(a.submissionCount || 0));
  } else if (by === 'newest') {
    sorted.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  }
  return sorted;
}

function boardCardHtml(item, now) {
  const tl = timeLeft(item.deadline, now);
  const fee = item.entryFeeUsd != null ? '<span class="fee">Entry fee ' + fmtUsd(item.entryFeeUsd) + '</span>' : '';
  const skills = (item.skills || []).slice(0, 4).map((s) => '<span>' + esc(s) + '</span>').join('');
  const sponsor = item.sponsor
    ? '<span class="entries">' + esc(item.sponsor.name) + (item.sponsor.isVerified ? ' ✓' : '') + '</span>'
    : '';
  return '<article class="card">'
    + '<div class="meta-row">' + categoryBadge(item.category) + sponsor + '</div>'
    + '<h2><a href="#/bounty/' + esc(item.slug) + '">' + esc(item.title) + '</a></h2>'
    + (item.summary ? '<p class="summary">' + esc(item.summary) + '</p>' : '')
    + '<div class="foot-row"><span class="pot">' + fmtUsd(item.potUsd) + ' <small>live pot</small></span>' + fee + '</div>'
    + '<div class="foot-row"><span class="timeleft' + (tl.urgent ? ' urgent' : '') + (tl.ended ? ' ended' : '') + '">' + esc(tl.label) + '</span>'
    + '<span class="entries">' + plural(item.submissionCount, 'entry', 'entries') + '</span></div>'
    + (skills ? '<div class="skills">' + skills + '</div>' : '')
    + '</article>';
}

function renderBoardInto(root, rerender) {
  const now = Date.now();
  const list = boardFiltered(now);
  const openCount = (boardState.items || []).filter((it) => boardIsOpenNow(it, now)).length;
  const closingSoon = (boardState.items || []).filter((it) => {
    const ms = Date.parse(it.deadline) - now;
    return boardIsOpenNow(it, now) && ms > 0 && ms < 24 * 3600000;
  }).length;
  const totalPot = (boardState.items || []).filter((it) => boardIsOpenNow(it, now)).reduce((s, it) => s + Number(it.potUsd || 0), 0);
  const totalEntries = (boardState.items || []).reduce((s, it) => s + Number(it.submissionCount || 0), 0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE_BOARD));
  if (boardState.page > pages) boardState.page = pages;
  const start = (boardState.page - 1) * PAGE_SIZE_BOARD;
  const pageItems = list.slice(start, start + PAGE_SIZE_BOARD);

  const catOptions = ['All', ...CATEGORIES].map((c) => '<option value="' + esc(c) + '"' + (boardState.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  root.innerHTML = '<div class="page-head"><h1>Live bounties</h1>'
    + '<p>Every open competition on make.fun, with its live pot, entry fee, time left and entries. A bounty past its deadline may still read “open” until results post — open means its deadline has not passed.</p></div>'
    + '<div class="stat-strip">'
    + '<div class="stat"><b>' + fmtInt(openCount) + '</b><span>open now</span></div>'
    + '<div class="stat"><b>' + fmtInt(closingSoon) + '</b><span>closing within 24h</span></div>'
    + '<div class="stat"><b>' + fmtUsd(totalPot) + '</b><span>total live pots</span></div>'
    + '<div class="stat"><b>' + fmtInt(totalEntries) + '</b><span>entries across all</span></div>'
    + '</div>'
    + '<div class="toolbar" role="search">'
    + '<input type="search" id="board-search" placeholder="Search title, skill, sponsor…" value="' + esc(boardState.search) + '" aria-label="Search bounties">'
    + '<select id="board-category" aria-label="Category">' + catOptions + '</select>'
    + '<select id="board-status" aria-label="Status">'
    + '<option value="open"' + (boardState.status === 'open' ? ' selected' : '') + '>Open now</option>'
    + '<option value="ended"' + (boardState.status === 'ended' ? ' selected' : '') + '>Ended</option>'
    + '<option value="all"' + (boardState.status === 'all' ? ' selected' : '') + '>All</option>'
    + '</select>'
    + '<select id="board-sort" aria-label="Sort by">'
    + '<option value="closing"' + (boardState.sort === 'closing' ? ' selected' : '') + '>Closing soonest</option>'
    + '<option value="pot"' + (boardState.sort === 'pot' ? ' selected' : '') + '>Largest pot</option>'
    + '<option value="entries"' + (boardState.sort === 'entries' ? ' selected' : '') + '>Most entries</option>'
    + '<option value="newest"' + (boardState.sort === 'newest' ? ' selected' : '') + '>Newest</option>'
    + '</select>'
    + '<span class="count">' + fmtInt(list.length) + ' shown</span>'
    + '</div>'
    + (pageItems.length
      ? '<div class="cards">' + pageItems.map((it) => boardCardHtml(it, now)).join('') + '</div>' + pagerHtml(boardState.page, pages, list.length)
      : emptyHtml('No bounties match', 'Try a different search, category or status.'))
    + '';

  const search = root.querySelector('#board-search');
  let searchTimer = null;
  search.addEventListener('input', () => {
    boardState.search = search.value;
    boardState.page = 1;
    const caret = search.selectionStart;
    clearTimeout(searchTimer);
    // Debounce: re-rendering replaces the input, so restore focus + caret after.
    searchTimer = setTimeout(() => {
      rerender();
      const next = root.querySelector('#board-search');
      if (next) {
        next.focus();
        const pos = Math.min(caret == null ? next.value.length : caret, next.value.length);
        try { next.setSelectionRange(pos, pos); } catch (e) { /* older browsers */ }
      }
    }, 150);
  });
  root.querySelector('#board-category').addEventListener('change', (e) => { boardState.category = e.target.value; boardState.page = 1; rerender(); });
  root.querySelector('#board-status').addEventListener('change', (e) => { boardState.status = e.target.value; boardState.page = 1; rerender(); });
  root.querySelector('#board-sort').addEventListener('change', (e) => { boardState.sort = e.target.value; boardState.page = 1; rerender(); });
  wirePager(root, boardState, rerender);
}

export async function renderBoard(root) {
  const rerender = () => renderBoardInto(root, rerender);
  const hadItems = !!boardState.items;
  if (!hadItems) root.innerHTML = loadingHtml('Loading live bounties…');
  try {
    // Re-fetch on every board visit: the ETag cache answers 304 within the
    // minute, so a repeat visit costs no bytes, and the board never goes stale.
    const [open, closed, resolved] = await Promise.all([
      listCompetitions('open'),
      listCompetitions('closed'),
      listCompetitions('resolved'),
    ]);
    boardState.items = [...open.items, ...closed.items, ...resolved.items];
  } catch (err) {
    if (!hadItems) {
      root.innerHTML = errorHtml('Could not load the bounty board.', err.message);
      wireRetry(root, () => renderBoard(root));
      return;
    }
    // Refresh failed but we have data: keep showing the previous board.
  }
  rerender();
}

/* ---------------- bounty page ---------------- */

function rewardsTableHtml(comp) {
  const rows = Array.isArray(comp.rewardsNow) && comp.rewardsNow.length
    ? comp.rewardsNow
    : Object.entries(comp.rewards || {}).map(([place, amount]) => ({ place: Number(place), baseUsd: String(amount), feeShareUsd: '0.00', amountUsd: String(amount) }));
  if (!rows.length) return '<p class="empty">No rewards published for this bounty yet.</p>';
  rows.sort((a, b) => Number(a.place) - Number(b.place));
  const total = rows.reduce((s, r) => s + Number(r.amountUsd || 0), 0);
  const body = rows.map((r) => '<tr><td>' + fmtInt(r.place) + '</td><td class="num">' + fmtUsd(r.baseUsd) + '</td><td class="num">' + fmtUsd(r.feeShareUsd) + '</td><td class="num"><b>' + fmtUsd(r.amountUsd) + '</b></td></tr>').join('');
  return '<div class="table-wrap"><table class="data"><thead><tr><th>Place</th><th class="num">Base reward</th><th class="num">Fee share</th><th class="num">Total now</th></tr></thead>'
    + '<tbody>' + body + '</tbody>'
    + '<tfoot><tr><td><b>Total</b></td><td class="num"></td><td class="num"></td><td class="num"><b>' + fmtUsd(total) + '</b></td></tr></tfoot></table></div>'
    + '<p class="entries">Live pot ' + fmtUsd(comp.potUsd) + ' — totals grow as entry fees are paid in.</p>';
}

function entriesTableHtml(submissions, state, rerender) {
  const sorted = (submissions || []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE_TABLE));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * PAGE_SIZE_TABLE;
  const pageItems = sorted.slice(start, start + PAGE_SIZE_TABLE);
  if (!sorted.length) return emptyHtml('No entries yet', 'Nobody has entered this bounty so far.');
  const rows = pageItems.map((s) => '<tr><td><a href="#/u/' + esc(s.hunter) + '">' + esc(s.hunter) + '</a></td>'
    + '<td class="wrap">' + esc(s.title || 'Untitled entry') + '</td>'
    + '<td>' + esc(s.status || '—') + '</td>'
    + '<td class="num">' + (s.score != null ? fmtInt(s.score) : '—') + '</td>'
    + '<td>' + fmtAgo(s.createdAt) + '</td></tr>').join('');
  return '<div class="table-wrap"><table class="data"><thead><tr><th>Hunter</th><th>Entry</th><th>Status</th><th class="num">Score</th><th>Entered</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + pagerHtml(state.page, pages, sorted.length);
}

export async function renderBounty(root, slug) {
  root.innerHTML = loadingHtml('Loading bounty…');
  let comp;
  try {
    comp = await getCompetition(slug, 'summary');
  } catch (err) {
    root.innerHTML = err.status === 404
      ? emptyHtml('No such bounty', 'There is no bounty with the slug “' + slug + '”. Check the address or go back to the board.')
      : errorHtml('Could not load this bounty.', err.message);
    wireRetry(root, () => renderBounty(root, slug));
    return;
  }
  const now = Date.now();
  const tl = timeLeft(comp.deadline, now);
  const takesEntries = comp.acceptingSubmissions === true && !tl.ended;
  const state = { page: 1 };
  const rerenderEntries = () => {
    const holder = root.querySelector('#entries-holder');
    if (holder && comp.submissions) {
      // entriesTableHtml already ends with the pager; wire it in place.
      holder.innerHTML = entriesTableHtml(comp.submissions, state, rerenderEntries);
      wirePager(holder, state, rerenderEntries);
    }
  };

  root.innerHTML = '<div class="crumbs"><a href="#/">Board</a> / ' + esc(comp.category || '') + '</div>'
    + '<div class="page-head"><h1>' + esc(comp.title) + '</h1>'
    + '<p>' + (comp.summary ? esc(comp.summary) : '') + '</p></div>'
    + '<div class="meta-row" style="margin-bottom:14px">' + categoryBadge(comp.category)
    + (comp.sponsor ? '<span class="entries">by ' + esc(comp.sponsor.name) + (comp.sponsor.isVerified ? ' ✓' : '') + '</span>' : '')
    + '<span class="pill' + (takesEntries ? '' : ' muted') + '">' + (takesEntries ? 'Open — takes entries' : tl.ended ? 'Ended — results pending' : esc(comp.status || '')) + '</span></div>'
    + '<div class="kv">'
    + '<div class="stat"><b>' + fmtUsd(comp.potUsd) + '</b><span>live pot</span></div>'
    + '<div class="stat"><b>' + (comp.entryFeeUsd != null ? fmtUsd(comp.entryFeeUsd) : 'Free') + '</b><span>entry fee</span></div>'
    + '<div class="stat"><b>' + fmtInt(comp.submissionCount) + '</b><span>entries</span></div>'
    + '<div class="stat"><b>' + esc(tl.label) + '</b><span>deadline · ' + fmtDate(comp.deadline) + '</span></div>'
    + '</div>'
    + '<div class="toolbar"><a class="btn primary" href="#/bounty/' + esc(comp.slug) + '/leaderboard">View leaderboard →</a>'
    + '<a class="btn" href="https://make.fun/bounty/' + esc(comp.slug) + '" target="_blank" rel="noopener">Open on make.fun ↗</a></div>'
    + '<div class="section"><h2>Rewards — live</h2>' + rewardsTableHtml(comp) + '</div>'
    + (comp.description ? '<div class="section prose"><h2>About this bounty</h2>' + renderMarkdown(comp.description) + '</div>' : '')
    + (comp.rules ? '<div class="section prose"><details open><summary><h2 style="display:inline">Rules</h2></summary>' + renderMarkdown(comp.rules) + '</details></div>' : '')
    + ((comp.phases || []).length ? '<div class="section"><h2>Phases</h2><div class="table-wrap"><table class="data"><thead><tr><th>Phase</th><th>Starts</th><th>Ends</th><th>Scores</th></tr></thead><tbody>'
      + comp.phases.map((p) => '<tr><td>' + esc(p.title || p.key) + '</td><td>' + fmtDate(p.startsAt) + '</td><td>' + fmtDate(p.endsAt) + '</td><td>' + esc(p.scores || '—') + '</td></tr>').join('') + '</tbody></table></div></div>' : '')
    + '<div class="section"><h2>Recent entries</h2><div id="entries-holder">' + loadingHtml('Loading entries…') + '</div></div>';

  // Entries come from the full detail; the summary above already painted.
  try {
    const full = await getCompetition(slug, 'list');
    comp.submissions = full.submissions || [];
    const holder = root.querySelector('#entries-holder');
    if (holder) {
      holder.innerHTML = entriesTableHtml(comp.submissions, state, rerenderEntries);
      wirePager(holder, state, rerenderEntries);
    }
  } catch (err) {
    const holder = root.querySelector('#entries-holder');
    if (holder) holder.innerHTML = '<p class="entries">Entries could not be loaded (' + esc(err.message) + '). The bounty details above are live.</p>';
  }
}

/* ---------------- leaderboard ---------------- */

const lbState = {
  slug: null,
  phase: 'dev',
  view: 'performance',
  rows: 'first',
  full: null,
  page: 1,
  sortKey: null,
  sortDir: 1,
};

function lbFormatCell(column, entry) {
  const key = column.key;
  const raw = entry.values ? entry.values[key] : undefined;
  if (raw == null) return '—';
  if (key === 'bytes') return fmtBytes(raw);
  if (key === 'valid') return raw ? '✓' : '—';
  if (typeof raw === 'number' && raw > 1000 && (key.includes('judge') || key.includes('rate') || key.includes('win'))) {
    return fmtMicroPercent(raw);
  }
  return fmtInt(raw);
}

function lbSortEntries(entries, columns) {
  const key = lbState.sortKey;
  if (!key) return entries;
  const col = columns.find((c) => c.key === key);
  const dir = (col && col.sorting === 'asc' ? 1 : -1) * lbState.sortDir;
  return entries.slice().sort((a, b) => {
    const av = a.values ? Number(a.values[key]) : NaN;
    const bv = b.values ? Number(b.values[key]) : NaN;
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return (av - bv) * dir;
  });
}

function lbTableHtml(data) {
  const columns = data.columns || [];
  const entries = lbSortEntries(data.entries || [], columns);
  const total = entries.length + (data.rest ? data.rest.length : 0);
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE_LEADERBOARD));
  if (lbState.page > pages) lbState.page = pages;
  const start = (lbState.page - 1) * PAGE_SIZE_LEADERBOARD;
  const pageItems = entries.slice(start, start + PAGE_SIZE_LEADERBOARD);
  if (!entries.length) return emptyHtml('No entries yet', 'Nobody has a scored entry on this leaderboard yet.');

  const head = columns.map((c) => {
    // Arrow follows the effective direction: a column whose natural order is
    // descending already sorts high-to-low at sortDir 1.
    const effDir = (c.sorting === 'asc' ? 1 : -1) * lbState.sortDir;
    const sorted = lbState.sortKey === c.key ? (effDir === 1 ? ' ▲' : ' ▼') : '';
    return '<th class="sortable num" data-sort="' + esc(c.key) + '">' + esc(c.title) + sorted + '</th>';
  }).join('');
  const rows = pageItems.map((e) => {
    const cells = columns.map((c) => {
      let cell = lbFormatCell(c, e);
      if (c.key === 'judge' && e.values && e.values.judge_low != null && e.values.judge_high != null) {
        cell = '<span title="90% interval ' + fmtMicroPercent(e.values.judge_low) + ' – ' + fmtMicroPercent(e.values.judge_high) + '">' + cell + '</span> ' + ciBarHtml(e.values.judge_low, e.values.judge_high, e.values.judge);
      }
      return '<td class="num">' + cell + '</td>';
    }).join('');
    const badges = (e.house ? '<span class="pill house">house</span> ' : '') + (e.baseline ? '<span class="pill muted">baseline</span> ' : '');
    return '<tr><td class="num"><b>' + fmtInt(e.rank) + '</b></td>'
      + '<td><a href="#/u/' + esc(e.handle) + '">' + esc(e.handle) + '</a> ' + badges + '</td>'
      + '<td class="wrap">' + esc(e.title || 'Untitled') + '</td>' + cells + '</tr>';
  }).join('');
  return '<div class="table-wrap"><table class="data"><thead><tr><th class="num">#</th><th>Hunter</th><th>Entry</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + pagerHtml(lbState.page, pages, entries.length)
    + '<p class="entries">' + fmtInt(total) + ' entries in this phase' + (data.rest ? ' · showing top ' + fmtInt(entries.length) : '') + ' · tie-break: ' + esc(data.tie_break ? data.tie_break.title : '—') + '</p>';
}

function leaderCardHtml(data) {
  const top = (data.entries || [])[0];
  if (!top || !top.values) return '';
  const v = top.values;
  const rate = v.judge != null ? fmtMicroPercent(v.judge) : '—';
  const low = v.judge_low != null ? fmtMicroPercent(v.judge_low) : null;
  const high = v.judge_high != null ? fmtMicroPercent(v.judge_high) : null;
  const j = top.judge || {};
  return '<div class="ci-card"><h2>Leader — ' + esc(top.handle) + ' · ' + esc(top.title || 'Untitled') + '</h2>'
    + '<p class="sub">Judge win rate with its 90% confidence interval (rate ± 1.6449 × standard error), from the API’s own columns.</p>'
    + '<div class="ci-big">' + rate + ' <small>win rate</small></div>'
    + (low && high ? '<div class="ci-track" role="img" aria-label="90% interval ' + low + ' to ' + high + '"><span class="ci-range" style="left:' + (Number(v.judge_low) / 10000).toFixed(2) + '%;width:' + Math.max(0, (Number(v.judge_high) - Number(v.judge_low)) / 10000).toFixed(2) + '%"></span><span class="ci-point" style="left:' + (Number(v.judge) / 10000).toFixed(2) + '%"></span></div>'
      + '<div class="ci-labels"><span>' + low + ' low</span><span>90% interval</span><span>' + high + ' high</span></div>' : '')
    + '<p class="sub" style="margin:10px 0 0">'
    + (j.matches != null ? fmtInt(j.wins) + ' wins · ' + fmtInt(j.losses) + ' losses · ' + fmtInt(j.matches) + ' matches' : '')
    + (top.rank_range ? ' · rank range ' + fmtInt(top.rank_range.best) + '–' + fmtInt(top.rank_range.worst) : '')
    + (j.provisional ? ' · provisional' : '')
    + '</p></div>';
}

export async function renderLeaderboard(root, slug) {
  const fresh = lbState.slug !== slug;
  if (fresh) {
    lbState.slug = slug;
    lbState.phase = 'dev';
    lbState.view = 'performance';
    lbState.rows = 'first';
    lbState.full = null;
    lbState.page = 1;
    lbState.sortKey = null;
  }
  const load = async () => {
    root.innerHTML = loadingHtml('Loading leaderboard…');
    let data;
    try {
      data = await getLeaderboard(slug, { phase: lbState.phase, view: lbState.view, rows: lbState.rows });
    } catch (err) {
      root.innerHTML = err.status === 404
        ? emptyHtml('No leaderboard here', 'There is no leaderboard for “' + slug + '” yet.')
        : errorHtml('Could not load the leaderboard.', err.message);
      wireRetry(root, load);
      return;
    }
    if (lbState.rows === 'all') lbState.full = data;
    const views = data.views || ['performance'];
    const phase = data.phase || {};
    root.innerHTML = '<div class="crumbs"><a href="#/">Board</a> / <a href="#/bounty/' + esc(slug) + '">' + esc((data.competition && data.competition.title) || slug) + '</a> / Leaderboard</div>'
      + '<div class="page-head"><h1>' + esc(data.title || 'Leaderboard') + ' — ' + esc((data.competition && data.competition.title) || slug) + '</h1>'
      + '<p>Phase: ' + esc(phase.title || lbState.phase) + (phase.ends_at ? ' · ends ' + fmtDate(phase.ends_at) : '') + (data.metrics_withheld ? ' · some metrics withheld' : '') + '</p></div>'
      + '<div class="tabs" role="tablist">'
      + views.map((v) => '<button class="btn' + (lbState.view === v ? ' active' : '') + '" data-view="' + esc(v) + '">' + esc(v) + '</button>').join('')
      + '<button class="btn' + (lbState.phase === 'dev' ? ' active' : '') + '" data-phase="dev">Development</button>'
      + '<button class="btn' + (lbState.phase === 'final' ? ' active' : '') + '" data-phase="final">Final</button>'
      + '</div>'
      + leaderCardHtml(data)
      + '<div id="lb-table">' + lbTableHtml(data) + '</div>'
      + (lbState.rows === 'first' && data.rest && data.rest.length
        ? '<p style="text-align:center"><button class="btn" data-action="load-all">Load full leaderboard (' + fmtInt(data.entries.length + data.rest.length) + ' entries)</button></p>'
        : '');

    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { lbState.view = b.dataset.view; lbState.page = 1; load(); }));
    root.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => { lbState.phase = b.dataset.phase; lbState.page = 1; load(); }));
    // Sort headers are bound by wireLbTable below; binding them here too
    // would fire the handler twice and invert the first click.
    wireLbTable(root, data, load);
    const loadAll = root.querySelector('[data-action="load-all"]');
    if (loadAll) loadAll.addEventListener('click', () => { lbState.rows = 'all'; lbState.page = 1; load(); });
  };
  await load();
}

function wireLbTable(root, data, load) {
  wirePager(root, lbState, () => {
    const holder = root.querySelector('#lb-table');
    if (holder) {
      holder.innerHTML = lbTableHtml(data);
      wireLbTable(root, data, load);
    }
  });
  root.querySelectorAll('#lb-table [data-sort]').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (lbState.sortKey === key) lbState.sortDir = -lbState.sortDir;
    else { lbState.sortKey = key; lbState.sortDir = 1; }
    const holder = root.querySelector('#lb-table');
    if (holder) {
      holder.innerHTML = lbTableHtml(data);
      wireLbTable(root, data, load);
    }
  }));
}

/* ---------------- profile ---------------- */

export async function renderProfile(root, handle) {
  root.innerHTML = loadingHtml('Loading profile…');
  let profile;
  let views = null;
  try {
    profile = await getProfile(handle);
    try { views = await getProfileViews(handle); } catch (e) { views = null; }
  } catch (err) {
    root.innerHTML = err.status === 404
      ? emptyHtml('No profile for @' + handle, 'No make.fun account uses that handle. Check the spelling, or find someone from a bounty’s entries.')
      : errorHtml('Could not load this profile.', err.message);
    wireRetry(root, () => renderProfile(root, handle));
    return;
  }
  const rec = profile.record || {};
  const solutions = (profile.solutions || []).slice().sort((a, b) => Date.parse(b.entered_at) - Date.parse(a.entered_at));
  const payouts = profile.payouts || [];
  const state = { page: 1 };
  const renderSolutions = () => {
    const pages = Math.max(1, Math.ceil(solutions.length / PAGE_SIZE_TABLE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE_TABLE;
    const pageItems = solutions.slice(start, start + PAGE_SIZE_TABLE);
    const holder = root.querySelector('#solutions-holder');
    if (!holder) return;
    if (!solutions.length) {
      holder.innerHTML = emptyHtml('No entries yet', 'This account has not entered a bounty yet.');
      return;
    }
    holder.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Competition</th><th>Place</th><th class="num">Prize</th><th>Score</th><th>Entered</th></tr></thead><tbody>'
      + pageItems.map((s) => '<tr><td class="wrap"><a href="#/bounty/' + esc(s.competition.slug) + '">' + esc(s.competition.title) + '</a></td>'
        + '<td>' + (s.placement != null ? '<span class="pill">' + fmtInt(s.placement) + '</span>' : '—') + '</td>'
        + '<td class="num">' + (s.prize_usd != null ? fmtUsd(s.prize_usd) : '—') + '</td>'
        + '<td>' + esc(scoreText(s.score)) + '</td>'
        + '<td>' + fmtAgo(s.entered_at) + '</td></tr>').join('')
      + '</tbody></table></div>' + pagerHtml(state.page, pages, solutions.length);
    wirePager(root, state, renderSolutions);
  };

  const links = [];
  if (profile.github_login) links.push('<a href="https://github.com/' + esc(profile.github_login) + '" target="_blank" rel="noopener">GitHub ↗</a>');
  if (profile.discord && profile.discord.url) links.push('<a href="' + esc(profile.discord.url) + '" target="_blank" rel="noopener">Discord ↗</a>');
  if (profile.x) links.push('<a href="https://x.com/' + esc(profile.x) + '" target="_blank" rel="noopener">X ↗</a>');
  if (profile.wallet && profile.wallet.explorer_url) links.push('<a href="' + esc(profile.wallet.explorer_url) + '" target="_blank" rel="noopener">Wallet ↗</a>');

  root.innerHTML = '<div class="crumbs"><a href="#/">Board</a> / Profiles</div>'
    + '<div class="profile-head">'
    + avatarHtml(profile.image || profile.avatar, profile.display_name || profile.handle)
    + '<div><h1>' + esc(profile.display_name || profile.handle) + '</h1>'
    + '<p class="handle">@' + esc(profile.handle) + (profile.house ? ' · house' : '') + (profile.demo ? ' · demo' : '') + ' · joined ' + fmtDate(profile.joined_at) + '</p>'
    + (profile.bio ? '<p class="bio">' + esc(profile.bio) + '</p>' : '')
    + (links.length ? '<div class="link-row">' + links.join('') + '</div>' : '')
    + '</div></div>'
    + '<div class="stat-strip">'
    + '<div class="stat"><b>' + fmtInt(rec.competitions_entered) + '</b><span>entered</span></div>'
    + '<div class="stat"><b>' + fmtInt(rec.competitions_placed) + '</b><span>placed</span></div>'
    + '<div class="stat"><b>' + fmtInt(rec.competitions_won) + '</b><span>won</span></div>'
    + '<div class="stat"><b>' + fmtInt(rec.podium_finishes) + '</b><span>podiums</span></div>'
    + '<div class="stat"><b>' + (rec.best_placement != null ? fmtInt(rec.best_placement) : '—') + '</b><span>best place</span></div>'
    + '<div class="stat"><b>' + fmtUsd(rec.prize_usd) + '</b><span>prizes won</span></div>'
    + (views ? '<div class="stat"><b>' + fmtInt(views.view_count) + '</b><span>profile views</span></div>' : '')
    + (views ? '<div class="stat"><b>' + fmtInt(views.entry_view_count) + '</b><span>entry views</span></div>' : '')
    + '</div>'
    + '<div class="section"><h2>Entries (' + fmtInt(solutions.length) + ')</h2><div id="solutions-holder"></div></div>'
    + (payouts.length ? '<div class="section"><h2>Payouts (' + fmtInt(payouts.length) + ')</h2><div class="table-wrap"><table class="data"><thead><tr><th>Competition</th><th>Place</th><th class="num">Amount</th><th>Paid</th><th>Receipt</th></tr></thead><tbody>'
      + payouts.map((p) => '<tr><td class="wrap"><a href="#/bounty/' + esc(p.competition.slug) + '">' + esc(p.competition.title) + '</a></td><td>' + fmtInt(p.place) + '</td><td class="num">' + fmtUsd(p.amount_usd) + '</td><td>' + fmtDate(p.paid_at) + '</td><td><a href="' + esc(p.explorer_url) + '" target="_blank" rel="noopener">Solana ↗</a></td></tr>').join('')
      + '</tbody></table></div></div>' : '');
  renderSolutions();
}
