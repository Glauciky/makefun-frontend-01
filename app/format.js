// Formatting helpers — money, time, micro-unit scores, dates, HTML escaping.

/** Escape text for safe insertion into HTML. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** US dollars: "$1,000.00", "$0.50", "$250". Accepts numbers or numeric strings. */
export function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

/** Integer with thousands separators. */
export function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Bytes as "703 KB" / "2.1 MB". */
export function fmtBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n % 1024 === 0 ? 0 : 1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/**
 * Leaderboard values are micro units (1,000,000 = 1.0). A judge win rate of
 * 973639 is 97.3639%. Returns a percent with two decimals.
 */
export function fmtMicroPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return (n / 10000).toFixed(2) + '%';
}

/** A micro-unit value as a plain decimal (rate 0.973639). */
export function fmtMicroRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return (n / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

/**
 * Time left until an ISO deadline, judged by the deadline — not by status:
 * a bounty past its deadline may still read status open until results post.
 * Returns { label, ended, urgent }.
 */
export function timeLeft(deadlineIso, nowMs) {
  const now = nowMs || Date.now();
  const end = Date.parse(deadlineIso);
  if (!Number.isFinite(end)) return { label: 'No deadline', ended: false, urgent: false };
  const ms = end - now;
  if (ms <= 0) {
    const ago = now - end;
    return { label: 'Ended ' + agoLabel(ago) + ' ago', ended: true, urgent: false };
  }
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  let label;
  if (days > 0) label = days + 'd ' + hours + 'h left';
  else if (hours > 0) label = hours + 'h ' + rest + 'm left';
  else label = rest + 'm left';
  return { label, ended: false, urgent: ms < 6 * 3600000 };
}

function agoLabel(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 48) return hours + 'h';
  return Math.floor(hours / 24) + 'd';
}

/** "Nov 16, 2026, 21:30 UTC" — always UTC so times match the API. */
export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

/** "2h ago" / "3d ago" for a past ISO time. */
export function fmtAgo(iso, nowMs) {
  const now = nowMs || Date.now();
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const ms = now - t;
  if (ms < 0) return 'just now';
  return agoLabel(ms) + ' ago';
}

/** Plural helper: "1 entry", "7,000 entries". */
export function plural(n, one, many) {
  return fmtInt(n) + ' ' + (Number(n) === 1 ? one : many);
}
