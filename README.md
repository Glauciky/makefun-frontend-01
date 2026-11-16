# make.fun frontend

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

A fast, read-only frontend for [make.fun](https://make.fun), built for the
“Build the best make.fun frontend” bounty. Static files, no build step, no
framework, no sign-in — it reads make.fun's public API in the browser.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 (`--port <n>` for another port).

## What it does

- **Board** (`#/`): every live bounty with its live pot, entry fee, time left
  and entries. Search, category, status and sort filters, 12 per page.
  “Open” is judged by the deadline, not by status alone — a bounty past its
  deadline may still read open until its results are published.
- **Bounty page** (`#/bounty/<slug>`): summary, live rewards table
  (base + fee share + total per place), dates, phases, rules, and recent
  entries.
- **Leaderboard** (`#/bounty/<slug>/leaderboard`): built from the API's own
  `columns[]`, sortable, with the leader's judge win rate and its 90%
  confidence interval drawn as a bar, plus per-row interval bars. Top 10
  first, full table on demand.
- **Profile** (`#/u/<handle>`): public profile with record stats
  (entered, placed, won, podiums, best place, prizes), entries, payouts
  and view counts.

## Speed

- First load is a handful of small files (HTML + one CSS + a few ES
  modules, system fonts, zero images or fonts of its own).
- API answers are cached in memory and revalidated with ETags
  (`If-None-Match`, 304 within the minute); answers younger than 45s are
  reused without a request. Each view makes one request for what it shows;
  lists paginate client-side.
- Long lists (thousands of leaderboard entries) are never rendered at
  once: the top 10 load first, the full table paginates 25 per page.

## Layout

- `app/` — the frontend: `index.html`, `style.css`, `main.js` (router),
  `api.js` (ETag-caching client), `format.js`, `markdown.js`, `views.js`.
- `main.ts` — the hand-in program: copies `app/` and `screenshots/` to
  `/output` and writes `dossier.json` with the kit's library.
- `screenshots/` — 3 screenshots of the app on live data (see `shots.json`).
- `serve.ts` — tiny static server for local use.
