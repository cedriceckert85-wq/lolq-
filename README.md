# lolQ

**A locally-running League of Legends companion app with composition-aware build recommendations.**

> Written for the Riot Games Developer Application — `README.md`

---

## Table of Contents

- [Overview](#overview)
- [The Problem lolQ Solves](#the-problem-lolq-solves)
- [About Me](#about-me)
- [Features](#features)
- [Architecture](#architecture)
- [Data Pipeline](#data-pipeline)
- [The Recommender Stack](#the-recommender-stack)
- [Riot API Usage](#riot-api-usage)
- [Compliance & Developer Policies](#compliance--developer-policies)
- [Technical Stack](#technical-stack)
- [Project State & Roadmap](#project-state--roadmap)
- [Why I Need a Production API Key](#why-i-need-a-production-api-key)

---

## Overview

lolQ is a desktop companion application for League of Legends that gives players **composition-aware build recommendations** during champion select. Unlike existing tools (u.gg, op.gg, lolalytics, mobalytics) which show a one-size-fits-all build per champion-and-role, lolQ analyzes the actual enemy team composition in real time and adjusts item, rune, and summoner-spell suggestions accordingly.

### Key Properties

| Property | Value |
|---|---|
| **Platform** | Windows (Tauri 2.x) |
| **Architecture** | Local-first, no remote backend |
| **Data Storage** | Local filesystem (parquet + JSON) |
| **Telemetry** | None |
| **Third-party SDKs** | None |
| **Account Login** | LCU lockfile only (Riot's local API) |
| **Distribution** | Personal-use, ~12 users (myself + 11 friends) |
| **Data Source** | Riot Developer API exclusively |

---

## The Problem lolQ Solves

Existing community build sites display recommended builds that are **averaged across all matchups**. This works fine for experienced players who adjust by reflex, but it's a real problem for newer players.

### The Failure Mode

A new tank player checks u.gg for their Ornn/Malphite/Sion build:

```
Ornn Top Lane (u.gg average across all matchups):
  Sunfire Aegis → Thornmail → Frozen Heart → Randuin's Omen
  → ~250 armor, ~60 MR
```

They follow this build into a game where the enemy team has 3 AP threats and 2 squishy carries. Result: a tank with massive armor and almost no magic resist getting one-shot by Syndra ult or Veigar combo — and they have no idea why, because **the build site told them this was the recommended build.**

### The Fix

lolQ makes enemy team composition a **first-class input** to the recommender:

```
Ornn Top Lane (lolQ, with enemy comp detected):
  ┌─────────────────────────────────────────────────┐
  │ vs 3+ AP                          [data-driven] │
  ├─────────────────────────────────────────────────┤
  │ Sunfire Aegis → Force of Nature → Spirit Visage │
  │                  └─ swap-in for MR              │
  │                                                 │
  │ ↑ Force of Nature promoted because enemy has    │
  │   3+ AP threats (rule: mr_vs_3ap)               │
  └─────────────────────────────────────────────────┘
```

The badge at the top tells the user *why* the build differs. This turns a frustrating "the build site lied to me" moment into a transparent "the build adjusted because the enemy team is mostly mages" — useful in the moment and educational over time.

---

## About Me

I am a **Grandmaster-tier ranked Solo/Duo player on EUW**. lolQ started as a personal tool for my own ranked play but expanded when 11 of my friends started playing the game and kept getting punished by the failure mode described above.

### Why I Will Maintain This Over Time

The statistical layer of the recommender (Phase 12) handles automatic updates: when a patch lands and item balance shifts, the aggregator re-runs and the per-archetype builds update themselves from new match data within a few collector cycles.

But statistics alone cannot capture everything. Some build choices are correct only:

- For specific player skill levels (Lethality first-item on Talon is correct at GM but wrong at Gold)
- In specific matchups the dataset cannot see as distinct (Renekton vs Riven is different from Renekton vs Aatrox even though both are "Fighter top lane")
- When the player understands a nuance not visible in match data (item timing windows, power spikes around objectives)

These nuances live in **hand-curated overrides** — JSON files under `assets/data/item_sets/`, `rune_sets/`, and `spell_sets/` that the aggregator deliberately leaves untouched when the file's `source` field is anything other than `auto_from_aggregator`.

My plan is to spend time over the months and patches following Phase 12's release **manually auditing** the auto-generated builds for the champions I actively play, comparing them against:

- My own ranked games
- High-elo VOD analysis
- Pro-play builds from Worlds/LEC/LCK

…and writing manual overrides where the data-driven build is suboptimal in a way the aggregator cannot detect. This is a **continuous, indefinite maintenance loop** — League's meta shifts every two weeks, and the app's quality depends on a human in the loop who actually plays the game at the level the dataset represents.

---

## Features

### 1. Live Champ-Select Recommendations

When the player enters champion select, lolQ:

1. Detects the LCU lockfile and subscribes to `/lol-champ-select/v1/session` events via WebSocket
2. Updates its internal model on every pick/ban
3. Classifies the enemy team into a comp archetype (one of ~8 k-modes clusters)
4. Looks up `(champion, lane, archetype)` in `builds_by_archetype.parquet`
5. Falls back hierarchically if the cell is sparse:
   - `(champion, lane, archetype)` → if < 50 matches
   - `(champion, lane, *)` → if < 30 matches
   - Phase 11 heuristic rules → if no data

### 2. LCU Apply Buttons

| Button | LCU Endpoint | What It Does |
|---|---|---|
| Apply Runes | `POST /lol-perks/v1/pages` | Writes the recommended rune page directly into the client |
| Apply Spells | `PATCH /lol-champ-select/v1/session/my-selection` | Sets D/F summoner spells |
| Cleanup Pages | `DELETE /lol-perks/v1/pages/{id}` | Removes old `lolQ:`-prefixed pages (LRU when slots full) |

All writes are **user-initiated** (button click, never automatic) and all created pages are prefixed with `lolQ:` for auditability.

### 3. Account Switcher

For users with multiple accounts (main + smurfs), keyboard shortcuts `1-9` switch accounts by:

1. Cleanly closing the League Client
2. Editing the Riot Client's `RiotClientInstalls.json` to point to the selected account
3. Relaunching the client
4. Re-attaching the LCU watchdog to the fresh client

**Credentials are stored in the Windows Credential Manager** (via Python `keyring`), never in plain-text files.

### 4. Stats Dashboard

A second route shows the user's own match history:

- Per-champion win rate
- KDA distribution
- Build history
- Lane assignment patterns

Refreshes via `/lol/match/v5/matches/by-puuid/{puuid}/ids` polling every 5 minutes when not in-game.

### 5. Research Mode

A third route lets the user browse build recommendations for any champion-and-lane combo without being in a champ select. Every item, rune, and spell is hover-annotated with sample size and Wilson lower-bound confidence interval.

---

## Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Host (Rust)                    │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │  SolidJS Frontend    │  │  Python Sidecar Manager  │ │
│  │  (TypeScript, Vite)  │  │  (subprocess lifecycle)  │ │
│  └──────────────────────┘  └──────────────────────────┘ │
└──────────────┬──────────────────────┬───────────────────┘
               │ HTTP + WebSocket     │ stdin/stdout
               │ (localhost only)     │ (process supervision)
               ▼                      ▼
       ┌───────────────────────────────────────┐
       │   FastAPI Sidecar (Python, uvicorn)   │
       │  ┌─────────────┐  ┌────────────────┐  │
       │  │  Collector  │  │   Aggregator   │  │
       │  │  (httpx)    │  │   (DuckDB)     │  │
       │  └─────────────┘  └────────────────┘  │
       │  ┌─────────────┐  ┌────────────────┐  │
       │  │  LCU Client │  │  Recommender   │  │
       │  │  (httpx)    │  │  (3 layers)    │  │
       │  └─────────────┘  └────────────────┘  │
       └───────┬───────────────────┬───────────┘
               │                   │
               ▼                   ▼
        ┌──────────────┐    ┌──────────────────┐
        │  Riot API    │    │   LCU Lockfile   │
        │  (TLS, prod) │    │  (localhost)     │
        └──────────────┘    └──────────────────┘
```

### Communication

| Channel | Protocol | Purpose |
|---|---|---|
| Frontend ↔ Sidecar | HTTP (REST) | Request/response: recommendations, account switches, history queries |
| Frontend ↔ Sidecar | WebSocket (JSON-line) | Real-time push: LCU state changes, collector progress, aggregator events |
| Sidecar ↔ Riot API | HTTPS | Match data, league data, account lookups |
| Sidecar ↔ LCU | HTTPS (self-signed) | Champ-select state, rune-page CRUD, spell apply |

All localhost communication is bound to `127.0.0.1` — never exposed externally.

---

## Data Pipeline

### The Collector

A FastAPI subprocess that pulls match data from Riot's Developer API. Grows the local parquet store from zero to ~200,000 matches over weeks of background operation.

#### Three Phases Per Cycle

**Phase 1 — PUUID Discovery** *(3 API calls total)*

```python
# Single call per tier — LeagueItemDTO now includes puuid directly
GET /lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5
GET /lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5
GET /lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5
```

This yields ~5,000-6,000 EUW Master+ puuids in just 3 calls, thanks to Riot's 2024 schema migration which added `puuid` directly to `LeagueItemDTO`.

**Phase 2 — Match-ID Enumeration**

```python
for puuid in harvested_puuids:
    for start in [0, 100, 200, ..., 900]:
        GET /lol/match/v5/matches/by-puuid/{puuid}/ids
            ?queue=420&type=ranked&count=100&start={start}
```

Hard cap: `start <= 1000` (Riot returns empty array beyond that).

**Phase 3 — Match-Detail Fetch**

```python
new_ids = harvested_ids - seen_match_ids  # DuckDB-backed dedup
for match_id in new_ids:
    GET /lol/match/v5/matches/{match_id}
    # parse into flat participant-row format (10 rows per match)
    # append to data/matches/{patch}/{date}/batch_{n}.parquet
```

### Rate Limiting

Header-driven, not hardcoded:

| Header | Used For |
|---|---|
| `X-App-Rate-Limit` | App-level quota (typically 500/10s + 30000/10min) |
| `X-App-Rate-Limit-Count` | Current usage in each window |
| `X-Method-Rate-Limit` | Per-endpoint quota |
| `X-Method-Rate-Limit-Count` | Per-endpoint usage |
| `Retry-After` (on 429) | Exact sleep duration in seconds |
| `X-Rate-Limit-Type` (on 429) | Which limit was exceeded (app/method/service) |

#### Key Behaviors

- Burst allowed up to **95%** of published quota (5% headroom for window-boundary jitter per developer-relations Issue #371)
- **Two separate limiters**: one for `euw1.api.riotgames.com`, one for `europe.api.riotgames.com` (independent buckets per Riot's per-region enforcement)
- On 429: sleep exactly `Retry-After` + 100-500ms jitter, **no exponential backoff** (Riot's value is authoritative)
- Exponential backoff reserved only for 500/502/503/504

#### Pseudocode

```python
class RiotLimiter:
    def __init__(self, host: str):
        self.host = host
        self.app_buckets: list[FixedWindow] = []
        self.method_buckets: dict[str, list[FixedWindow]] = {}
    
    async def acquire(self, method: str) -> None:
        await self._wait_for_capacity(method)
    
    def update_from_headers(self, headers: dict, method: str) -> None:
        self._parse_app_limits(headers)
        self._parse_method_limits(headers, method)
    
    async def handle_429(self, response: Response) -> float:
        retry_after = int(response.headers["Retry-After"])
        limit_type = response.headers["X-Rate-Limit-Type"]
        jitter = random.uniform(0.1, 0.5)
        return retry_after + jitter
```

### Connection Pooling

```python
client = httpx.AsyncClient(
    limits=httpx.Limits(
        max_connections=50,
        max_keepalive_connections=25,
        keepalive_expiry=30.0,
    ),
    timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
)
# Single long-lived client — NOT one per request
```

Concurrency bounded by `asyncio.Semaphore(25)` — sufficient to saturate the 500/10s cap at ~45-48 req/s sustained throughput.

### OTP-Targeted Collector

For rare champions (Bard, Aurelion Sol, Ivern, Mel, Briar), random sampling is too slow. The OTP collector targets known high-elo one-trick-pony players:

```bash
uv run python -m scripts.collect_otp \
    --champion bard \
    --riot-ids "Player1#EUW,Player2#EUW,Player3#EUW" \
    --max-per-player 1000
```

**Yield comparison:**

| Approach | Bard matches in 10 min |
|---|---|
| Random Master+ sampling | ~5-15 (Bard pickrate <1%) |
| 5 Bard OTPs (~80% pickrate each) | ~4,000-5,000 |

OTP data is written to a separate path (`data/matches/otp_curated/<champion>/`) with extra columns:

| Column | Purpose |
|---|---|
| `data_source` | Always `"otp_curated"` for OTP rows, distinguishes from random pool |
| `source_puuid` | Which OTP this match came from (for skill-weighting later) |
| `otp_riot_id` | Human-readable Riot ID for debugging |

The recommender treats OTP-curated as a **separate candidate pool** to prevent skill-ceiling inflation when mixed with random samples.

### The Aggregator

DuckDB-based pipeline that produces seven output parquets:

| Output | Key | Purpose |
|---|---|---|
| `champion_winrate.parquet` | (champion, role, tier, patch) | Overall champion win rate |
| `item_winrate.parquet` | (champion, role, item_id) | Per-item win rate — fixes sparsity issue of old `item_build_winrate` |
| `rune_winrate.parquet` | (champion, role, rune_id, slot) | Per-slot rune win rate |
| `summoner_spell_winrate.parquet` | (champion, role, spell1, spell2) | Spell combo win rate |
| `matchup_table.parquet` | (champion, role, opponent_champion) | 1v1 matchup table |
| `build_transitions.parquet` | (champion, role, item_n, item_n+1) | Markov model over item order |
| `builds_by_archetype.parquet` | (champion, role, archetype, item_slot, item_id) | **Phase 12 artifact** — comp-aware builds |

#### Bayesian Smoothing

Every win-rate cell stores both:

- Raw fraction: `wins / games`
- Bayesian-smoothed estimate

Smoothing uses an empirical-Bayes Beta prior:

```python
# Prior mean = global (champion, lane) win rate
# Prior strength α + β = 50 effective games
wr_smoothed = (wins + α) / (games + α + β)

# Wilson lower bound at 95% CI also stored
wilson_lb = wilson_score_interval(wins, games, confidence=0.95).lower
```

**Recommender ranks by Wilson lower bound**, not raw win rate — intrinsic protection against high-variance recommendations from small samples.

---

## The Recommender Stack

Three layers that escalate in sophistication:

```
┌─────────────────────────────────────────────────────────┐
│ Phase 12: Statistical Comp-Slicing                      │
│   Per-(champion, lane, enemy_archetype) builds          │
│   Active when cell has ≥50 matches                      │
├─────────────────────────────────────────────────────────┤
│ Phase 11: Heuristic Adaptive Rules                      │
│   30-60 hand-curated rules in rules.toml                │
│   Fallback when Phase 12 cell is sparse                 │
├─────────────────────────────────────────────────────────┤
│ Phase 9: Wilson-Ranked Baseline                         │
│   Best build per (champion, role) by Wilson LB          │
│   Always-available foundation                           │
└─────────────────────────────────────────────────────────┘
```

### Phase 9: Wilson-Ranked Baseline (foundation, ships first)

```python
def recommend_base(champion: str, role: str) -> Build:
    rows = duckdb.query(f"""
        SELECT item_combo, wins, games, 
               wilson_lower_bound(wins, games) as lb
        FROM item_build_winrate
        WHERE champion = '{champion}' AND role = '{role}'
        ORDER BY lb DESC LIMIT 1
    """).fetchone()
    return Build.from_row(rows)
```

Deterministic, fully interpretable. Works at zero data via hand-curated overrides in `assets/data/item_sets/*.json`.

### Phase 11: Heuristic Adaptive Layer

Rules engine reads from a single `rules.toml`:

```toml
[[rule]]
id = "mr_vs_3ap"
condition = "enemy_tags_count(['Mage']) >= 3"
items_promote = [4644, 6655, 4401]   # Hexdrinker, Banshee's, Force of Nature
items_demote = [3047, 3110]          # Plated Steelcaps, Frozen Heart
priority_shift = 2
weight = 0.20
description_de = "Gegner hat 3+ AP — MR-Items priorisieren"
```

Every triggered rule is returned in the API response so the frontend can render a "why" tooltip on each modified item. **Interpretability is non-negotiable** — this is what differentiates lolQ from black-box ML recommenders.

### Phase 12: Statistical Comp-Slicing (the main differentiator)

#### Enemy Comp Encoding

```python
# Per-match feature extraction
features = {
    "tank_count": count_tags(enemy_team, "Tank"),
    "ap_count":   count_tags(enemy_team, "Mage"),
    "ranged_count": count_ranged(enemy_team),
    "cc_score":   calculate_cc_score(enemy_team),
}

# Cluster via k-modes (categorical k-means variant)
archetype_id = kmodes_predict(features, persisted_centroids)
# → one of ~6-12 stable clusters
```

#### Recommendation

```python
def recommend_adaptive(champion, role, enemy_team) -> Build:
    archetype = encode_comp(enemy_team)
    
    # Try most specific cell first
    cell = lookup_cell(champion, role, archetype)
    if cell.games >= 50:
        return cell.build_from_wilson_lb(), source="data-driven"
    
    # Fall back to less-specific
    cell = lookup_cell(champion, role, archetype="*")
    if cell.games >= 30:
        # Apply Phase 11 rules on top of base build
        base = cell.build_from_wilson_lb()
        return apply_heuristic_rules(base, enemy_team), source="heuristic"
    
    # Last resort: hand-curated
    return load_curated(champion, role), source="baseline"
```

The UI shows the source as a small badge: `[data-driven]`, `[heuristic]`, or `[baseline]`.

### Comparison to Existing Tools

| Tool | Champion+Lane | vs 1 Opponent | vs Full Comp |
|---|---|---|---|
| u.gg | ✅ | ✅ (single) | ❌ |
| op.gg | ✅ | ✅ (single) | ❌ |
| lolalytics | ✅ | ✅ (single, pairwise) | ❌ |
| mobalytics | ✅ | ✅ (single) | ❌ |
| blitz.gg | ✅ | ❌ | ❌ |
| probuilds.net | ✅ | ❌ | ❌ |
| **lolQ (Phase 12)** | ✅ | ✅ | ✅ **(8 archetypes)** |

---

## Riot API Usage

### Endpoints Used

| Endpoint | Purpose | Host |
|---|---|---|
| `/lol/league/v4/challengerleagues/by-queue/{queue}` | PUUID discovery | `euw1.api.riotgames.com` |
| `/lol/league/v4/grandmasterleagues/by-queue/{queue}` | PUUID discovery | `euw1.api.riotgames.com` |
| `/lol/league/v4/masterleagues/by-queue/{queue}` | PUUID discovery | `euw1.api.riotgames.com` |
| `/lol/match/v5/matches/by-puuid/{puuid}/ids` | Match enumeration | `europe.api.riotgames.com` |
| `/lol/match/v5/matches/{matchId}` | Match details | `europe.api.riotgames.com` |
| `/riot/account/v1/accounts/by-riot-id/{name}/{tag}` | OTP resolution | `europe.api.riotgames.com` |

### Endpoints **Not** Used

| Endpoint | Why Not |
|---|---|
| Live Client Data API (port 2999) | In-game data is **out of scope** — lolQ is champ-select-only |
| Spectator API | Not used |
| Tournament API | Not used |
| Champion Mastery | Could be added but not currently needed |

### Throughput Budget

With a Production-tier key (500 req/10s, 30,000 req/10min):

| Workload | Estimated Throughput | Time to 200k matches |
|---|---|---|
| Steady-state collection | ~45-48 req/s sustained | ~6-8 weeks of background operation |
| Catch-up after downtime | ~50 req/s peak | ~1-2 days for 100k backlog |

---

## Compliance & Developer Policies

### LCU Writes Policy

lolQ writes to two LCU endpoints:

| Endpoint | Purpose | Safety Properties |
|---|---|---|
| `POST /lol-perks/v1/pages` | Apply rune page | User-initiated, prefixed `lolQ:`, reversible |
| `PATCH /lol-champ-select/v1/session/my-selection` | Set summoner spells | User-initiated, only during PLANNING phase |

These are documented LCU endpoints used by mainstream tools (Mobalytics, Blitz, OP.GG Desktop, Porofessor) for the same purpose without enforcement action over multiple years. The app's writes are:

- ✅ **User-initiated** (button click, never automatic)
- ✅ **Reversible** (cleanup function removes all `lolQ:` pages)
- ✅ **Auditable** (all created pages prefixed for identification)
- ✅ **Scoped** (no other LCU resources touched — no friend-list, chat, match-history, in-game state)

### Data Collection Policy

- ✅ **Riot API exclusively** — no scraping of u.gg, lolalytics, op.gg, etc.
- ✅ **No reverse-engineering** — no game-client memory inspection, packet capture, or undocumented endpoints
- ✅ **Anonymized at storage** — PUUIDs are stored but never associated with any external identifier in the local DB

### Competitive Integrity Policy

- ✅ **Pre-game only** — app provides champ-select recommendations exclusively
- ✅ **No in-game overlay** — no minimap awareness, no DPS calc, no cooldown tracker
- ✅ **No real-time advantage** — every recommendation is statistical, based on historical data, with no live-game data feed

### Rate-Limit Respect

- ✅ Header-driven implementation (not hardcoded quotas)
- ✅ Operates at ≤95% of published quota
- ✅ Single API key per user, no multi-key evasion
- ✅ Refuses to start collector on missing/revoked key (401/403 fail-fast)

### Account-Switcher Safety

- ✅ Credentials in Windows Credential Manager (Windows-native secret store)
- ✅ Uses Riot's own `RiotClientInstalls.json` mechanism
- ✅ No session-token storage, no login-dialog scripting
- ✅ Does not facilitate account sharing/selling

---

## Technical Stack

### Stack Choices

| Layer | Technology | Why |
|---|---|---|
| Backend | Python 3.12 + FastAPI + uvicorn | polars + DuckDB ecosystem for data processing |
| Runtime Host | Tauri 2.x (Rust) | ~30MB MSI vs ~150MB Electron, ~80MB RAM vs ~400MB |
| Frontend | SolidJS + Vite + TypeScript | ~140KB gzipped (vs ~280KB React), compile-time reactivity |
| UI Components | @kobalte/core + Tailwind CSS | Accessibility primitives without prescribing visual style |
| Match Storage | Apache Parquet (date/patch partitioned) | Columnar, polars-native, DuckDB-scannable |
| Aggregation | DuckDB (in-process) | SQL over parquet without round-tripping through a DB server |
| HTTP Client | httpx async (raw) | Smaller surface than wrappers, custom rate-limiter |
| Credentials | Python `keyring` → Windows Credential Manager | Windows-native, encrypted at rest |
| Build | pnpm + uv + cargo | Modern, fast, reproducible |

### Why Raw `httpx` Instead of a Wrapper

I evaluated `riotwatcher`, `pulsefire`, `cassiopeia`, and `pyot`. None were chosen because:

1. **Hardcoded rate limits** — most wrappers don't read `X-Method-Rate-Limit` dynamically, instead hardcoding quotas that may not match a production key
2. **Race conditions** — RiotWatcher's own docs warn: *"In a multithreaded environment, you may still get some 429 errors"*
3. **Small API surface** — lolQ uses ~6 endpoints; a wrapper is overhead, not value
4. **Edge-case maintenance** — wrappers don't always track Riot's undocumented quirks (e.g., the `start <= 1000` cap on matchlist pagination)

The in-tree rate-limiter is ~150 lines of code, unit-tested with `respx` mocking, and updates dynamically from response headers on every request.

---

## Project State & Roadmap

### Completed Phases

| Phase | Description | Status |
|---|---|---|
| 1–8 | Foundation: Tauri sidecar, collector, aggregator, MSI build | ✅ Complete |
| 9 | Account-switcher, stats dashboard, Wilson-ranked recommender, 20k collector run | ✅ Complete |
| 10A | Rune data pipeline + parser extension (9 perk fields per match) | ✅ Complete |
| 10.5 | Runes Editor UI + LCU apply | ✅ Complete |
| 10.6 | Spells Editor UI + LCU apply | ⏳ In progress |
| 10B | OTP-Targeted Collector | ✅ Complete |

### Upcoming Phases

| Phase | Description | ETA | Required Data |
|---|---|---|---|
| 10.5.1 | Rune-generator bug-fix (slot-aware Wilson) | This week | None |
| 10.7 | Per-item winrate aggregation fix | This week | None |
| 11 | Heuristic Adaptive Rules (30-60 rules) | Next weekend | Current 14k matches sufficient |
| 12 | **Statistical Comp-Slicing** | ~2-3 months | ~200k matches needed |
| 13 | (Optional) ML Hybrid with Word2Vec embeddings | ~6 months | ~300k matches needed |

---

## Why I Need a Production API Key

### Development Key Limitations

| Limit | Development Key | Production Key |
|---|---|---|
| App limit (10s) | 20 req/s | 500 req/s |
| App limit (10min) | 100 req | 30,000 req |
| Expiration | Every 24h | Renewable annually |
| Suitable for | Prototyping | Sustained data collection |

### Throughput Required for Phase 12

To reach ~200,000 matches and maintain it across patches:

- **Patch cadence**: ~2 weeks
- **Match retention** (Riot's): ~2 years details, ~1 year timelines
- **Required collection rate**: ~10,000-15,000 matches per week to stay ahead of retention horizon
- **At dev-key rate**: ~864 matches/day max → ~6,000/week → **collector lags behind retention**
- **At production rate**: ~30,000+ matches/day possible → keeps store current

Without a production-tier key, Phase 12 (the core differentiator described in this entire README) is not achievable. The collector would fall behind Riot's data retention before reaching the sample size needed for stable per-archetype recommendations.

### Commitment

This is a personal-use tool maintained by an active Grandmaster player. It will continue to be maintained as long as I play League, which based on my history is likely indefinite. The code is version-controlled and the architecture is designed for continuous, patch-by-patch updates — both statistical (automated via aggregator) and manual (via hand-curated overrides).

---

## Contact

This README is part of the application materials for the Riot Developer API Production tier.

**Project**: lolQ
**Author**: Cedric (Grandmaster EUW)
**Use case**: Personal-use companion app for ~12 users (myself + 11 friends)
**Repository**: (private at the time of application)

---

*Built locally. Stays locally. No telemetry, no analytics, no remote backend. Just better builds.*
