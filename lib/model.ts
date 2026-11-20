// Launch Radar's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The board's universe is the watchlist's own rule with the TVL floor taken off (see isRankable):
// every protocol that records no token and is not a wrapped, staked or bridged product of a protocol
// whose token already trades. On this snapshot that is 198 protocols, and it contains all 40
// watchlist slugs: the watchlist is the floor, never the ceiling.
//
// Implied value is priced from the snapshot's own figures, the same function for every row:
//
//   implied = tvl_usd x peer_multiple(category) x momentum_factor x maturity_factor
//
// - peer_multiple: the median market-cap-to-TVL ratio of the snapshot's already-tokened protocols
//   in the same category — what the market itself pays per dollar of TVL for that kind of
//   protocol — shrunk toward the market-wide median by sample size and clamped, so a thin or
//   eccentric category cannot dominate. It is computed from the snapshot at run time, never
//   written down per protocol, and no protocol name is special-cased anywhere in this file.
// - momentum_factor: the seven-day TVL change, clamped to [-50, +100] per cent and scaled by
//   MOMENTUM_WEIGHT. An unreported change is neutral.
// - maturity_factor: the days the protocol has run with no token, listed_at to the snapshot's
//   as_of, mapped linearly from MATURITY_BASE to MATURITY_BASE + MATURITY_SPAN over four years.
//   A long tokenless track record is evidence of a real protocol with its launch still ahead.
//
// Farm plans are generated per protocol from its own record: the category picks the core action,
// the first chain picks where gas is paid, the TVL tier sizes the capital, and the age sets the
// holding window. Every step states a cost and a duration.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-price the board by hand. */
export interface ModelConstants {
  shrink_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 6,
  multiple_floor: 0.03,
  multiple_cap: 2.5,
  momentum_weight: 0.35,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  maturity_base: 0.75,
  maturity_span: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the README quotes it. */
export const MODEL_VERSION = 'peer-multiple-1';

/** How many live-token protocols the dashboard's already-trading reference carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    category_median: number | null;
    momentum_factor: number;
    maturity_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  category_median: number | null;
  momentum_factor: number;
  maturity_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live reference set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to 4 decimal places, for the model's working as the page states it. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, taken on a sorted copy so runs agree byte for byte. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// The board's universe: the watchlist rule without the floor.
// ---------------------------------------------------------------------------

/** Categories the watchlist rule keeps off the board: pass-throughs of a token that already trades. */
const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a version marker is one release of a protocol, not a launch candidate. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The whole words that mark a wrapped or staked product of another protocol's token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's own product, not a candidate. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol may be ranked: pre-token and not a pass-through of a token that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Peer multiples: what the market pays per TVL dollar, by category.
// ---------------------------------------------------------------------------

/** One category's peer evidence: how many tokened peers, their median ratio, the shrunk multiple. */
export interface PeerMultiple {
  peers: number;
  category_median: number | null;
  multiple: number;
}

/** The peer multiples for every category in the snapshot, plus the market-wide fallback. */
export interface PeerTable {
  global_median: number;
  by_category: Map<string | null, PeerMultiple>;
}

/**
 * Price each category from the snapshot's own live protocols: the median market-cap-to-TVL
 * ratio of the tokened protocols in it, shrunk toward the global median by the sample size
 * (multiple = (n x category median + k x global median) / (n + k)) and clamped to
 * [MULTIPLE_FLOOR, MULTIPLE_CAP]. Categories with no tokened peers take the global median.
 */
export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const ratiosByCategory = new Map<string | null, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const list = ratiosByCategory.get(p.category);
    if (list === undefined) ratiosByCategory.set(p.category, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 1;
  const byCategory = new Map<string | null, PeerMultiple>();
  const categories = new Set<string | null>([...ratiosByCategory.keys(), ...snapshot.protocols.map((p) => p.category)]);
  for (const category of categories) {
    const ratios = ratiosByCategory.get(category);
    if (ratios === undefined || ratios.length === 0) {
      byCategory.set(category, { peers: 0, category_median: null, multiple: round4(clampMultiple(globalMedian, model)) });
      continue;
    }
    const med = median(ratios);
    const shrunk = (ratios.length * med + model.shrink_weight * globalMedian) / (ratios.length + model.shrink_weight);
    byCategory.set(category, { peers: ratios.length, category_median: round4(med), multiple: round4(clampMultiple(shrunk, model)) });
  }
  return { global_median: round4(globalMedian), by_category: byCategory };
}

/** A peer multiple held inside the model's stated bounds. */
function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

// ---------------------------------------------------------------------------
// Scoring: one function, every protocol, only snapshot figures.
// ---------------------------------------------------------------------------

/** The factors one protocol gets, and the implied value they multiply to. */
export interface Score {
  implied: number;
  peer: PeerMultiple;
  momentum_factor: number;
  maturity_factor: number;
  age: number | null;
}

/** Score one pre-token protocol under the model. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, peers: PeerTable, model: ModelConstants = MODEL): Score {
  const peer = peers.by_category.get(p.category) ?? { peers: 0, category_median: null, multiple: round4(clampMultiple(peers.global_median, model)) };
  const change = finite(p.change_7d, 0);
  const clamped = Math.min(model.momentum_cap_pct, Math.max(model.momentum_floor_pct, p.change_7d === null ? 0 : change));
  const momentum = 1 + (clamped / 100) * model.momentum_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_base + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_span;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * momentum * maturity));
  return { implied, peer, momentum_factor: round4(momentum), maturity_factor: round4(maturity), age };
}

// ---------------------------------------------------------------------------
// Farm plans: generated from the protocol's own category, chains, TVL and age.
// ---------------------------------------------------------------------------

/** A small deterministic hash of a slug, so plan phrasing varies by protocol but never by run. */
function slugHash(slug: string): number {
  let h = 7;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** Capital a farm position on this protocol reasonably needs, from its TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** Weeks to hold, from the protocol's age: younger protocols qualify activity over a longer window. */
function holdWeeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  if (age < 730) return 5;
  if (age < 1095) return 4;
  return 3;
}

/** What one transaction roughly costs on a chain, so a plan's costs are honest per network. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 in ETH gas if you wait for a quiet block';
  if (chain === 'Solana') return 'well under $0.10 in SOL fees';
  if (chain === 'Bitcoin') return 'about $2 in BTC fees at a normal mempool';
  if (chain === 'Tron') return 'about $1 in TRX or energy fees';
  return 'about $0.40 in gas on that network';
}

/** The core qualifying action for a category, in the words a farmer can follow. */
function coreAction(category: string | null, name: string, chain: string, capital: number): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('collateral market'))
    return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain}; curator vaults record deposits per wallet, which is the balance a launch snapshot would read.`;
  if (c.includes('lending') || c.includes('uncollateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay, so the wallet shows both sides of the lending market.`;
  if (c.includes('dex'))
    return `Swap about $${capital} of volume through ${name} on ${chain} across a few pairs, then provide $${Math.max(25, capital / 2)} of liquidity to its main pool and keep the position open.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate'))
    return `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small hedged position, closing it after a day so the wallet has real trading history, not just a deposit.`;
  if (c.includes('cdp'))
    return `Open a collateral position on ${name} (${chain}): deposit $${capital} of collateral and mint a modest amount of its stablecoin, keeping the health factor comfortably above liquidation.`;
  if (c.includes('rwa'))
    return `Complete ${name}'s onboarding on ${chain} and mint $${capital} of its real-world-asset token; RWA launches reward holders of record, so the position has to sit in your own wallet.`;
  if (c.includes('basis'))
    return `Deposit $${capital} of USDC into ${name}'s basis-trading vault on ${chain} and keep the shares; the vault's deposit ledger is the record a distribution would use.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} in two separate transfers on different days, and use the bridged funds in one app on the far side each time.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} (${chain}) and take positions in at least three different markets, letting one settle so the account shows resolved as well as open trades.`;
  if (c.includes('chain'))
    return `Bridge $${capital} to ${name}'s network and become a user: swap on its main DEX, use one lending market and hold a small balance there for the full holding window.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the network's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet for the whole window.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and stake a smaller amount on the underwriting side if it is open.`;
  if (c.includes('index'))
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it; index launches are usually read from holder snapshots, so do not route it through another wrapper.`;
  if (c.includes('stablecoin') || c.includes('dual-token'))
    return `Mint or deposit $${capital} of ${name}'s stable asset on ${chain} and route one real payment or swap through it, so the wallet is a user and not only a minter.`;
  if (c.includes('btc'))
    return `Deposit $${capital} of BTC value into ${name} on ${chain} and keep the wrapped position open; BTC-layer launches are read from deposit balances at snapshot height.`;
  if (c.includes('otc'))
    return `Register on ${name} (${chain}) and complete one OTC trade of about $${capital}; a filled trade, not a quote request, is what marks the wallet as a user.`;
  if (c.includes('payment') || c.includes('card'))
    return `Activate ${name} on ${chain} and route about $${capital} of real spending or transfers through it across the window, in several transactions rather than one.`;
  if (c.includes('governance'))
    return `Hold $${capital} of position in ${name} (${chain}) and vote in every governance proposal during the window; voter rolls are the cheapest record a launch can reward.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager') || c.includes('leveraged'))
    return `Deposit $${capital} of USDC into ${name}'s main vault or pool on ${chain} and keep the shares unstaked in the depositing wallet, where a snapshot can see them.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its main product and keep the position open, so the wallet appears in the protocol's own activity record.`;
}

/** The follow-through action: a second, different touch the same protocol records. */
function secondAction(category: string | null, name: string, chain: string, capital: number): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp'))
    return `Add a second, smaller supply of $${Math.max(25, capital / 4)} on ${chain} a week later; two deposits a week apart read as a user, one lump reads as a snapshot tourist.`;
  if (c.includes('dex'))
    return `Come back on a different day and swap once more on ${name}, ideally in the other direction; repeat swappers on separate days are the pattern DEX launches usually weight.`;
  if (c.includes('derivative'))
    return `Repeat with a second small trade the following week on ${name}; consistency across weeks matters more than size for trading-history snapshots.`;
  if (c.includes('bridge') || c.includes('chain'))
    return `Bridge a smaller amount back the other way once, so the wallet has traffic in both directions on ${name} rather than a single one-way hop.`;
  return `Make one more qualifying deposit or action of $${Math.max(25, capital / 4)} on ${name} about a week after the first; spaced activity is what separates a farmer from a one-block snapshot.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, all derived from the
 * protocol's own record. Phrasing rotates on a hash of the slug so plans do not read as one
 * slogan repeated, while the numbers stay the protocol's own.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const weeks = holdWeeksFor(age);
  const gas = gasNote(chain);
  const h = slugHash(p.slug);
  const openers = [
    `Start with a fresh wallet funded only with what this farm needs, and save its address in your farm log.`,
    `Use one dedicated wallet for ${p.name} so its activity is clean and attributable, and note the address in your log.`,
    `Prepare a separate wallet for this protocol; a wallet that only farms ${p.name} is easier to track and to unwind.`,
  ];
  const cadence = [
    `Repeat one qualifying action each week for ${weeks} weeks — a deposit, a swap, a vote or a claim — so the wallet appears in several weekly snapshots, not one.`,
    `Keep a weekly rhythm for ${weeks} weeks: one real action on ${p.name} every week, on roughly the same day, which is the pattern points programs usually count.`,
    `Show up weekly for ${weeks} weeks with one genuine transaction each time; bursts in a single day are the first thing sybil filters throw out.`,
  ];
  return [
    `${openers[h % openers.length]} Cost: the wallet's first funding transaction, ${gas}. Time: 10 minutes.`,
    `${coreAction(p.category, p.name, chain, capital)} Cost: $${capital} of capital plus ${gas}. Time: 20 minutes to set up.`,
    `${secondAction(p.category, p.name, chain, capital)} Cost: about $2 of gas on ${chain}. Time: 10 minutes.`,
    `${cadence[h % cadence.length]} Cost: roughly $2 of gas a week on ${chain}. Time: 10 minutes a week for ${weeks} weeks.`,
    `Hold the position for the full ${weeks} weeks and check ${p.name}'s own announcements or points page every week or so; if a points program opens, register the same wallet there. Cost: the $${capital} stays in the position. Time: ${weeks} weeks, 5 minutes a check.`,
    `When you unwind, withdraw to the same wallet and keep the transaction hashes with your log; never pay a third party to "unlock" or claim a launch allocation. Cost: ${gas} to exit. Time: 15 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

/** The protocols the board ranks, strongest first, with ranks 1..n and every watchlist slug in. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.score.age,
    implied_value_usd: s.score.implied,
    model: {
      peer_multiple: s.score.peer.multiple,
      peer_count: s.score.peer.peers,
      category_median: s.score.peer.category_median,
      momentum_factor: s.score.momentum_factor,
      maturity_factor: s.score.maturity_factor,
      age_days: s.score.age,
    },
    farm_steps: farmSteps(s.p, s.score.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's already-trading reference view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** A board row's form for data.js: the same figures and the same farm plan the board carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    category_median: row.model.category_median,
    momentum_factor: row.model.momentum_factor,
    maturity_factor: row.model.maturity_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: peers.global_median,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, spread, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
