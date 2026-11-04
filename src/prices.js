import { setTimeout as sleep } from 'node:timers/promises';
import { ASSETS, ZEC } from './config.js';

const API = 'https://api.coingecko.com/api/v3';
const SPOT_TTL_MS = 60_000;
const RETRY_DELAYS_MS = [3_000, 10_000];
// A free CoinGecko demo key lifts the shared per-IP limit that cloud servers hit.
const HEADERS = {
  accept: 'application/json',
  ...(process.env.COINGECKO_API_KEY && { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }),
};

// USD prices for ZEC and the tracked xStocks, from CoinGecko's keyless API.
export class Prices {
  #spot = { at: 0, quote: null };
  #inflight = null;
  #history = new Map();

  // { ts, ZEC, AAPLX, TSLAX, ... } in USD.
  // Concurrent callers share one request: bursts are what trip the keyless rate limit.
  spot() {
    if (Date.now() - this.#spot.at < SPOT_TTL_MS) return Promise.resolve(this.#spot.quote);
    this.#inflight ??= this.#fetchSpot().finally(() => (this.#inflight = null));
    return this.#inflight;
  }

  async #fetchSpot() {
    const ids = [ZEC, ...Object.values(ASSETS)].map((a) => a.coingecko).join(',');
    const body = await getJson(`${API}/simple/price?ids=${ids}&vs_currencies=usd`);
    const quote = { ts: Math.floor(Date.now() / 1000), ZEC: body[ZEC.coingecko].usd };
    for (const [symbol, asset] of Object.entries(ASSETS)) quote[symbol] = body[asset.coingecko].usd;
    this.#spot = { at: Date.now(), quote };
    return quote;
  }

  // Spot USD price of any CoinGecko id, e.g. 'bitcoin' for Bitrefill's BTC-priced catalog.
  async usd(id) {
    const body = await getJson(`${API}/simple/price?ids=${id}&vs_currencies=usd`);
    return body[id].usd;
  }

  // Market price of a symbol ('ZEC' or an xStock) closest to a unix time.
  async at(symbol, ts) {
    const id = symbol === 'ZEC' ? ZEC.coingecko : ASSETS[symbol]?.coingecko;
    if (!id) throw new Error(`unknown symbol ${symbol}`);
    const series = await this.#series(id, ts);
    let best = series[0];
    for (const point of series) {
      if (Math.abs(point[0] / 1000 - ts) < Math.abs(best[0] / 1000 - ts)) best = point;
    }
    return best[1];
  }

  // One cached hour of 5-minute points per asset keeps us under the keyless rate limit.
  async #series(id, ts) {
    const hour = Math.floor(ts / 3600) * 3600;
    const key = `${id}:${hour}`;
    if (!this.#history.has(key)) {
      const url = `${API}/coins/${id}/market_chart/range?vs_currency=usd&from=${hour - 1800}&to=${hour + 5400}`;
      // Cache the request itself, so parallel audits share it; drop it if it fails.
      this.#history.set(key, getJson(url).then((body) => body.prices));
      this.#history.get(key).catch(() => this.#history.delete(key));
    }
    return this.#history.get(key);
  }
}

// The keyless API rate-limits per IP, so back off and retry on 429 instead of failing an audit.
async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 && attempt < RETRY_DELAYS_MS.length) {
    await sleep(RETRY_DELAYS_MS[attempt]);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`price feed ${res.status} for ${url}`);
  return res.json();
}
