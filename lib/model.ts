// Token radar model, version radar-3: a snapshot in, a ranked board out.
//
// The board ranks every pre-token protocol the house's watchlist rule would keep — the 40
// watchlist slugs plus every other pre-token protocol below or above the floor that is not a
// wrapped, staked or bridged product of a token that already trades, not an exchange, and not a
// versioned pool. Protocols whose token already trades are never ranked; they are shown apart in
// the Live view at their market's own value. No protocol name is ever special-cased: the same
// function scores every row, from the snapshot's own figures only.
//
// Implied value (USD) for one protocol. The radar-2 model multiplied TVL straight through, so
// the board was nearly a TVL ranking (Spearman 0.96 against TVL rank; 18 of the top 20 were the
// 20 largest protocols). Radar-3 counts TVL at diminishing returns: the size base is TVL's cube
// root, anchored at $1,000,000,000, so a protocol at $1B is scored exactly as radar-2 scored it,
// a giant above $1B is compressed and a small protocol below $1B is lifted. With TVL's spread
// cut from 550x to 8x, the other figures — seven-day growth and how long a protocol has run with
// no token — can actually move ranks (Spearman 0.71; 115 of 198 rows move ten or more places
// against radar-2, while the top of the board stays the large, long-running protocols).
//
//   size base        TVL ^ (1/3) x $1B ^ (2/3)       (equals TVL at $1B; $1.40B for $2.75B TVL)
//   category multiple  TVL is worth more where the protocol takes a fee: exchanges and lenders
//                       0.36-0.38, yield and RWA 0.30-0.32, curators and allocators 0.28,
//                       staking 0.24, anything else 0.18.
//   growth multiplier  1 + 0.8 x clamp(change_7d, -50, 200) / 100   (0.60 to 2.60)
//   maturity           0.65 + min(age_days, 1460) / 1460 x 0.60      (0.65 to 1.25);
//                       a protocol that has run for years with no token is overdue one, so age
//                       pays; unknown age scores 0.90. Under 90 days old, x 0.80: unproven.
//   breadth            1 + 0.02 x min(chains - 1, 8)                 (1.00 to 1.16)
//   implied = max(1, round(size base x category x growth x maturity x breadth x young))
//
// Farm plans are derived from the same record: the category picks the action, the first chain
// picks where it happens and which gas token it needs, the TVL tier picks the capital, the age
// picks the hold. Every step names the protocol and its chain, states what it costs and how long
// it takes, and no step repeats verbatim across rows.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The model's constants, stated on the dashboard so a reader can check the maths. */
export interface ModelConstants {
  tvl_power: number;
  tvl_anchor_usd: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_mult: number;
  young_age_days: number;
  young_discount: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  tvl_power: 3,
  tvl_anchor_usd: 1_000_000_000,
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 200,
  maturity_floor: 0.65,
  maturity_range: 0.6,
  maturity_days: 1460,
  unknown_age_mult: 0.9,
  young_age_days: 90,
  young_discount: 0.8,
  breadth_per_chain: 0.02,
  breadth_max_chains: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    tvl_base_usd: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    young_discount: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js, farm plan included. */
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
  implied_value_usd: number;
  tvl_base_usd: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  young_discount: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
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

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * What one dollar of TVL is worth, by what the protocol does. Fee-taking venues earn the most;
 * a chain or an uncategorised protocol earns the least. Matched on the category string only.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual') || c.includes('leveraged farm')) return 0.38;
  if (c.includes('lend') || c.includes('cdp')) return 0.36;
  if (c.includes('yield') || c.includes('farm')) return 0.32;
  if (c.includes('rwa') || c.includes('basis trad') || c.includes('cedefi')) return 0.3;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return 0.28;
  if (c.includes('restak') || c.includes('staking')) return 0.24;
  if (c.includes('bridge')) return 0.2;
  return 0.18;
}

/**
 * The size base: TVL through its cube root, anchored at `anchor` so the base equals TVL exactly
 * at the anchor. A protocol ten times smaller than the anchor keeps a base about 2.2x smaller,
 * not 10x — size still matters, but it no longer decides the board on its own.
 */
export function sizeBase(tvlUsd: number, model: ModelConstants): number {
  const p = 1 / model.tvl_power;
  return Math.pow(Math.max(0, tvlUsd), p) * Math.pow(model.tvl_anchor_usd, 1 - p);
}

/** The multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; tvlBase: number; catMult: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; youngDisc: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const tvlBase = sizeBase(protocol.tvl_usd, model);
  const catMult = categoryMultiple(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    age === null
      ? model.unknown_age_mult
      : model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const youngDisc = age !== null && age < model.young_age_days ? model.young_discount : 1;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(tvlBase * catMult * growthMult * maturityMult * breadthMult * youngDisc));
  return { implied, tvlBase, catMult, growthPct, growthMult, maturityMult, breadthMult, youngDisc, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  const name = p.name ?? '';
  if (VERSIONED.test(name)) return true;
  if (WRAPPED_WORD.test(name.toLowerCase())) return true;
  const lower = name.toLowerCase();
  return EXCHANGE_PREFIXES.some((e) => lower.startsWith(e));
}

/** Whether the board may rank a protocol: pre-token and not a wrapped product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the exclusion rule keeps, floor or not.
  // The watchlist is the floor, never the ceiling.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      tvl_base_usd: Math.round(s.v.tvlBase),
      category_multiple: s.v.catMult,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      young_discount: s.v.youngDisc,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One step as a single string: action, cost, time — within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The gas token of a chain, matched on the chain's name; the chain's own token when unknown. */
export function gasToken(chain: string): string {
  const c = chain.toLowerCase();
  const table: Array<[string, string]> = [
    ['ethereum', 'ETH'], ['arbitrum', 'ETH'], ['optimism', 'ETH'], ['base', 'ETH'],
    ['ink', 'ETH'], ['linea', 'ETH'], ['scroll', 'ETH'], ['zksync', 'ETH'],
    ['mode', 'ETH'], ['blast', 'ETH'], ['unichain', 'ETH'], ['taiko', 'ETH'],
    ['zircuit', 'ETH'], ['abstract', 'ETH'], ['soneium', 'ETH'], ['world chain', 'ETH'],
    ['robinhood', 'ETH'], ['boba', 'ETH'], ['kroma', 'ETH'], ['mint', 'ETH'],
    ['manta', 'ETH'], ['fraxtal', 'frxETH'],
    ['solana', 'SOL'], ['binance', 'BNB'], ['bnb', 'BNB'], ['bsc', 'BNB'], ['opbnb', 'BNB'],
    ['polygon', 'POL'], ['avalanche', 'AVAX'], ['tron', 'TRX'], ['sui', 'SUI'],
    ['aptos', 'APT'], ['near', 'NEAR'], ['monad', 'MON'], ['hyperliquid', 'HYPE'],
    ['hyperevm', 'HYPE'], ['berachain', 'BERA'], ['sonic', 'S'], ['flare', 'FLR'],
    ['stellar', 'XLM'], ['mantle', 'MNT'], ['sei', 'SEI'], ['injective', 'INJ'],
    ['cardano', 'ADA'], ['algorand', 'ALGO'], ['tezos', 'XTZ'], ['hedera', 'HBAR'],
    ['flow', 'FLOW'], ['celo', 'CELO'], ['kava', 'KAVA'], ['cronos', 'CRO'],
    ['fantom', 'FTM'], ['gnosis', 'xDAI'], ['moonbeam', 'GLMR'], ['astar', 'ASTR'],
    ['osmosis', 'OSMO'], ['cosmos', 'ATOM'], ['thorchain', 'RUNE'], ['bitcoin', 'BTC'],
    ['ton', 'TON'], ['stacks', 'STX'], ['multiversx', 'EGLD'], ['elrond', 'EGLD'],
    ['vechain', 'VET'], ['zilliqa', 'ZIL'], ['harmony', 'ONE'], ['fuse', 'FUSE'],
    ['metis', 'METIS'],
  ];
  for (const [needle, token] of table) if (c.includes(needle)) return token;
  return "the chain's gas token";
}

/** What one gas transaction on this chain costs, in dollars, by its gas token. */
function gasFeeUsd(gas: string): number {
  if (gas === 'ETH') return 5;
  if (gas === 'SOL') return 1;
  if (gas === 'BNB') return 2;
  return 3;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The setup step: a fresh wallet, the chain's gas token, and the bridge to the chain. */
function setupStep(p: SnapshotProtocol, capital: number, chain: string): FarmStep {
  const gas = gasToken(chain);
  const fee = gasFeeUsd(gas);
  if (chain.toLowerCase() === 'ethereum') {
    return {
      text: `Set up a fresh wallet to farm ${p.name} on Ethereum: buy ${gas} for gas on your main exchange, move $${capital} of USDC into the wallet, and write the seed phrase on paper and keep it offline.`,
      cost: `about $${fee} of gas for the first transaction`,
      time: '20 minutes',
    };
  }
  return {
    text: `Set up a fresh wallet to farm ${p.name} on ${chain}: buy ${gas} for gas on your main exchange, bridge $${capital} of USDC to ${chain} through its official bridge, and write the seed phrase on paper and keep it offline.`,
    cost: `about $${fee} of gas and bridge fees`,
    time: '20 minutes',
  };
}

/** The category's main action, in the words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow $20 of a stablecoin against it, then repay the borrow.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the LP position open.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`;
  if (c.includes('basis trad')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to the ${name} chain, swap half for its gas token and use one of its apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action for the same protocol, on the same chain. */
function secondAction(p: SnapshotProtocol, second: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Use ${name} a second time on ${chain}: deposit a different collateral asset worth $${second} and leave it supplied.`;
  if (c.includes('dex')) return `Swap $${second} through ${name} on ${chain} in a different pool, so the wallet shows trading as well as liquidity.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Close the first position, then open a second one on ${name} on ${chain} in the opposite direction with $${second} of margin.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Claim or compound the vault's rewards once on ${name} on ${chain}, then redeposit them into the same vault.`;
  if (c.includes('rwa')) return `Hold the ${name} asset on ${chain} for one full distribution cycle and check the payout lands in the wallet.`;
  if (c.includes('basis trad')) return `Top up the ${name} basis vault on ${chain} with $${second} and keep the position open.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${second} into a second ${name} vault on ${chain} with a different strategy.`;
  if (c.includes('restak') || c.includes('staking')) return `Delegate a second $${second} stake to a different validator through ${name} on ${chain}.`;
  if (c.includes('chain')) return `Use a second app on the ${name} chain with $${second}, such as its largest lending market.`;
  return `Swap $${second} through ${name} on ${chain} so the wallet shows a second kind of activity.`;
}

/** The weekly action: one small, category-specific touch that keeps the wallet active. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Once a week, open ${name} on ${chain}, check the borrow rate, and top up the supplied collateral by $10 or repay $10 of the borrow so the position stays active.`;
  if (c.includes('dex')) return `Once a week, swap $10 through a different ${name} pool on ${chain} and add $10 of liquidity to the pool with the deepest TVL.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Once a week, close and reopen a small hedged position on ${name} on ${chain} with $10 of margin, keeping the net exposure near zero.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Once a week, claim the ${name} vault rewards on ${chain} and compound them back into the vault, even when the claim is only a few dollars.`;
  if (c.includes('rwa')) return `Once a week, check the ${name} distribution on ${chain} and confirm the latest payout landed in the wallet.`;
  if (c.includes('basis trad')) return `Once a week, check the ${name} basis vault on ${chain} and add $10 when the funding rate is in your favour.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Once a week, move $10 between two ${name} vaults on ${chain} so the wallet shows activity in more than one strategy.`;
  if (c.includes('restak') || c.includes('staking')) return `Once a week, check the ${name} staking rewards on ${chain} and restake the accrued amount, however small.`;
  if (c.includes('chain')) return `Once a week, use a different app on the ${name} chain with $10, such as its largest DEX pool.`;
  return `Once a week, do one small ${name} action on ${chain} — a $10 swap, deposit or vote — and never let a month pass with no activity.`;
}

/** The hold step: how long to stay in, and why the protocol's age sets it. */
function holdStep(p: SnapshotProtocol, capital: number, chain: string, age: number | null): FarmStep {
  const hold = holdDaysFor(age);
  const why =
    age === null
      ? 'with no listing date on record, a longer hold is the safe play'
      : age < 180
        ? 'young protocols count longer activity windows'
        : age < 365
          ? 'a mid-age protocol rewards steady positions across snapshots'
          : 'a long-running protocol rewards steady positions across snapshots';
  return {
    text: `Keep the ${p.name} position on ${chain} open for at least ${hold} days — ${why} — and check it every Sunday so it is never idle for a full snapshot window.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  };
}

/** The check step: the protocol's own rewards page, named by what it does. */
function verifyStep(p: SnapshotProtocol, chain: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  let page = 'points or rewards page';
  let balance = 'points';
  if (c.includes('lend') || c.includes('cdp')) { page = 'rewards tab'; balance = 'supply points'; }
  else if (c.includes('dex')) { page = 'liquidity mining page'; balance = 'LP points'; }
  else if (c.includes('derivative') || c.includes('perpetual')) { page = 'trading rewards page'; balance = 'volume points'; }
  else if (c.includes('yield') || c.includes('farm') || c.includes('leveraged') || c.includes('basis trad')) { page = 'vault rewards page'; balance = 'accrued points'; }
  else if (c.includes('rwa')) { page = 'holder dashboard'; balance = 'distribution'; }
  else if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) { page = 'vault points page'; balance = 'points across both vaults'; }
  else if (c.includes('restak') || c.includes('staking')) { page = 'staking rewards page'; balance = 'restaked'; }
  else if (c.includes('chain')) { page = "chain's points page"; balance = 'activity score'; }
  return {
    text: `Before you withdraw, open ${name}'s ${page} on ${chain}, confirm the ${balance} balance, and write the wallet, the dates and every transaction in a farm log.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list,
 * and every step names the protocol and its chain, so no two rows share a step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  // The second action is smaller than the first: half the capital at the top tier, less below.
  const secondCapital = capital >= 250 ? 50 : capital >= 150 ? 25 : 10;
  const gas = gasToken(chain);
  const gasFee = gasFeeUsd(gas);
  const steps: FarmStep[] = [
    setupStep(p, capital, chain),
    { text: mainAction(p, capital, chain), cost: `$${capital} of capital and about $${gasFee} of gas`, time: '15 minutes to set up' },
    { text: secondAction(p, secondCapital, chain), cost: `about $${secondCapital} of capital and $2 of gas`, time: '10 minutes' },
    { text: weeklyAction(p, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    holdStep(p, capital, chain, age),
    verifyStep(p, chain),
  ];
  return steps.map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
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
    }));
}

/** A board row's compact form for data.js. */
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
    implied_value_usd: row.implied_value_usd,
    tvl_base_usd: row.model.tvl_base_usd,
    category_multiple: row.model.category_multiple,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    young_discount: row.model.young_discount,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
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
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
