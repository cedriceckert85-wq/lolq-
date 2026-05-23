# lolQ — League of Legends Companion App

Personal Windows desktop tool that surfaces champion-select pick and
item-build recommendations from aggregated Riot Match-V5 data.

## Status

Personal use, single user. Not for distribution. Not endorsed by Riot Games.

## What it does

- Pulls Riot Match-V5 data into a local DuckDB + Parquet store
- Aggregates per-(champion, role) statistics: Wilson-bounded win rates,
  item-build pareto fronts, matchup deltas, rune-set recommendations
- Connects to the League Client via the LCU API to detect Champion-Select
  state (read-only)
- Displays pick / item / rune recommendations inline during champ-select

## What it doesn't do

- No public-facing leaderboards
- No data resale or third-party redistribution
- No game-bot or in-game automation
- No monetization

## Stack

- Backend: Python 3.12 — FastAPI, DuckDB, Polars, Pulsefire (Riot API client)
- Frontend: SolidJS + Vite + Tailwind v4
- Shell: Tauri 2 (Rust launcher + WebView, spawns Python sidecar)
- Data: ~170 static champions, ~163 items, live Match-V5 aggregations

## Rate-limit behaviour

- Respects `X-App-Rate-Limit`, `X-Method-Rate-Limit`, `Retry-After` headers
- Semaphore-bounded concurrency on Riot API calls
- DuckDB-based match-ID deduplication prevents redundant re-fetches
- Exponential backoff with jitter on 429

## Legal

lolQ isn't endorsed by Riot Games and doesn't reflect the views or
opinions of Riot Games or anyone officially involved in producing or
managing League of Legends. League of Legends and Riot Games are
trademarks or registered trademarks of Riot Games, Inc. League of
Legends © Riot Games, Inc.
