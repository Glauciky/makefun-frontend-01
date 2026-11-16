// make.fun public API client — read-only, no sign-in, no keys.
//
// Every answer is cached in memory and revalidated with its ETag. The API's
// ETags are bound to the minute: an If-None-Match inside the same minute
// answers 304, so a repeat visit costs no bytes. Within a short freshness
// window we do not even ask: the cached answer is returned at once.

export const API_BASE = 'https://make.fun/api';

// Freshness window: inside it, return the cached answer without a request.
export const FRESH_MS = 45000;

// url -> { etag, body, at }
const cache = new Map();

function cacheKey(url) {
  return url;
}

/** Fetch JSON, using the in-memory ETag cache. Throws an Error with .status. */
export async function fetchJson(url) {
  const key = cacheKey(url);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < FRESH_MS) return hit.body;

  const headers = {};
  if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    // Offline with a previous answer: serve the stale body instead of failing.
    if (hit) return hit.body;
    const e = new Error('Network error reaching make.fun: ' + err.message);
    e.status = 0;
    throw e;
  }
  if (res.status === 304 && hit) {
    hit.at = now;
    return hit.body;
  }
  if (!res.ok) {
    const e = new Error('make.fun API ' + res.status + ' for ' + url);
    e.status = res.status;
    throw e;
  }
  const body = await res.json();
  const etag = res.headers.get('etag');
  cache.set(key, { etag, body, at: now });
  return body;
}

/** Drop every cached answer (used after a manual refresh). */
export function clearCache() {
  cache.clear();
}

/** List competitions of one status, following cursors. Returns { items }. */
export async function listCompetitions(status) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ status, limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const data = await fetchJson(API_BASE + '/competitions?' + q.toString());
    items.push(...(data.items || []));
    cursor = data.next_cursor || null;
    if (!cursor) break;
  }
  return { items };
}

/** One competition. submissions: 'list' (default, includes entries) or 'summary' (light). */
export function getCompetition(slug, submissions) {
  const q = submissions ? '?submissions=' + encodeURIComponent(submissions) : '';
  return fetchJson(API_BASE + '/competitions/' + encodeURIComponent(slug) + q);
}

/**
 * A competition's leaderboard, built from the API's own columns[].
 * params: { phase, view, rows } — rows 'first' returns the top 10 plus a
 * `rest` list; rows 'all' returns every entry (large: paginate client-side).
 */
export function getLeaderboard(slug, params) {
  const q = new URLSearchParams();
  if (params && params.phase) q.set('phase', params.phase);
  if (params && params.view) q.set('view', params.view);
  if (params && params.rows) q.set('rows', params.rows);
  const suffix = q.toString() ? '?' + q.toString() : '';
  return fetchJson(API_BASE + '/competitions/' + encodeURIComponent(slug) + '/leaderboard' + suffix);
}

/** A public profile by handle. */
export function getProfile(handle) {
  return fetchJson(API_BASE + '/profiles/' + encodeURIComponent(handle));
}

/** A profile's view counts. */
export function getProfileViews(handle) {
  return fetchJson(API_BASE + '/profiles/' + encodeURIComponent(handle) + '/views');
}
