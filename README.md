# launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/verad-xe/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/verad-xe/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks 198 protocols that record no token yet by what a launch could be worth, using a value model derived entirely from the sealed snapshot's own figures: each protocol's TVL is priced at its category's peer multiple, then adjusted for seven-day TVL momentum, for how long the protocol has run without a token, and for how many chains it is live on. Every row carries a concrete farm plan with costs and durations. The dashboard is a sortable, filterable board with a per-protocol detail view that shows the model's factor breakdown, plus a reference view of protocols whose tokens already trade, kept apart from the ranked board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

`snapshot.json` is the sealed DefiLlama snapshot the bounty hands out (in the grader it is mounted at `/input/snapshot.json`, which is the default input). The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`; open `out/dashboard/index.html` in a browser to read the radar. No network is needed at any step.

## How the value model works

The model lives in `lib/model.ts` and scores every protocol with the same function. No protocol name is ever special-cased, and every input is one of the snapshot's own ten fields.

**The board's universe.** A protocol is a candidate when it records no token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or bridged product of a protocol whose token already trades. The board applies the watchlist's own exclusion rules — the bridge, liquid staking, restaking and exchange categories, names ending in a version marker, names carrying the whole words *wrapped*, *staked* or *staking*, and names beginning with an exchange's name — but without the watchlist's $50M TVL floor. That yields 198 rankable protocols and contains all 40 watchlist slugs: the watchlist is the floor, never the ceiling.

**Implied value.** For each candidate:

```
implied_value_usd = TVL x peer_multiple(category) x momentum_factor x maturity_factor x reach_factor
```

- **Peer multiple.** For every category, the model collects the snapshot's already-tokened protocols in that category and takes the median of their market-cap-to-TVL ratios — what the market actually pays per dollar of TVL for that kind of protocol. Small samples are shrunk toward the market-wide median (weight 6): `multiple = (n x category_median + 6 x global_median) / (n + 6)`, and the result is clamped to [0.03, 2.5] so a thin or eccentric category cannot dominate. A category with no tokened peers uses the global median.
- **Momentum factor.** The seven-day TVL change, clamped to [-50%, +100%], scaled by 0.35: `1 + clamped_change / 100 x 0.35`. A protocol growing into its launch is worth more than one bleeding TVL; an unreported change is neutral.
- **Maturity factor.** Days between `listed_at` and the snapshot's `as_of`, mapped linearly from 0.75 (brand new) to 1.20 (four years or more without a token): a long tokenless track record is evidence the protocol is real, durable and still has its launch ahead of it. An unknown listing date counts as one year.
- **Reach factor.** The number of chains in the protocol's `chains` record: `1 + 0.02 x min(chain_count - 1, 10)`, so a single-chain protocol scores 1.00 and one live on eleven or more chains scores 1.20. A protocol live on more chains offers more surfaces to farm and more communities a token would be distributed into, so breadth earns a bounded premium.

**Farm plans.** Each row's plan is generated from that protocol's own record — its category decides the core action (supply and borrow for lending, swap and provide liquidity for a DEX, deposit into curated vaults for a risk curator, and so on), its first chain decides where gas is paid, its TVL tier sizes the suggested capital ($50–$500), and its age sets the holding window (3–8 weeks). Every step states what it costs and how long it takes.

**Determinism.** The program reads only the snapshot, sorts with slug tie-breaks, and writes byte-identical output on every run.

## Layout

- `main.ts` — the entry point: reads the snapshot, writes the board, the dashboard data and the dossier.
- `lib/model.ts` — the universe rule, the value model, the farm-plan generator and the board's self-check.
- `dashboard/` — the static page (board, detail view, filters, already-trading reference), no framework, no network.
- `screenshots/` — the board, a detail view and a filtered view, rendered from the real page.
- `vendor/makefun-board.ts` — the vendored make.fun dossier library, unmodified.

---

Entered on [make.fun](https://make.fun/?ref=05egkt5w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
