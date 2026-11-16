// Router and bootstrap for the make.fun frontend.
//
// Hash routes (each reachable by link and by its own URL):
//   #/                              bounty board
//   #/bounty/<slug>                 one bounty's page
//   #/bounty/<slug>/leaderboard     that bounty's leaderboard
//   #/u/<handle>                    a public profile
//
// window.__shotReady is false while a route is loading and true once its
// data has rendered, so a screenshot script can wait for a finished view.
// A 20s fallback sets it true anyway, so a slow API never hangs a shot.

import { renderBoard, renderBounty, renderLeaderboard, renderProfile } from './views.js';

const view = document.getElementById('view');
let shotTimer = null;

function setShotReady(ready) {
  window.__shotReady = ready;
  if (shotTimer) {
    clearTimeout(shotTimer);
    shotTimer = null;
  }
  if (!ready) {
    shotTimer = setTimeout(() => { window.__shotReady = true; }, 20000);
  }
}

function parseRoute() {
  const hash = window.location.hash || '#/';
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'board' };
  if (parts[0] === 'bounty' && parts[1] && parts[2] === 'leaderboard') {
    return { name: 'leaderboard', slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'bounty' && parts[1]) {
    return { name: 'bounty', slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'u' && parts[1]) {
    return { name: 'profile', handle: decodeURIComponent(parts[1]) };
  }
  return { name: 'board' };
}

function markNav(route) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', (route.name === 'board' && a.dataset.nav === 'board') || (route.name === 'profile' && a.dataset.nav === 'profile'));
  });
}

async function route() {
  const r = parseRoute();
  markNav(r);
  setShotReady(false);
  window.scrollTo(0, 0);
  try {
    if (r.name === 'board') await renderBoard(view);
    else if (r.name === 'bounty') await renderBounty(view, r.slug);
    else if (r.name === 'leaderboard') await renderLeaderboard(view, r.slug);
    else if (r.name === 'profile') await renderProfile(view, r.handle);
  } catch (err) {
    view.innerHTML = '<div class="error"><h2>Something went wrong</h2><p>' + String(err && err.message ? err.message : err) + '</p><button class="btn primary" data-action="retry">Try again</button></div>';
    const btn = view.querySelector('[data-action="retry"]');
    if (btn) btn.addEventListener('click', route);
  }
  setShotReady(true);
}

document.getElementById('profile-lookup').addEventListener('submit', (e) => {
  e.preventDefault();
  const handle = document.getElementById('lookup-handle').value.trim().replace(/^@/, '');
  if (handle) window.location.hash = '#/u/' + encodeURIComponent(handle);
});

window.addEventListener('hashchange', route);
window.__shotReady = false;
route();
