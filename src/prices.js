import { ASSETS, ZEC } from './config.js';

const API = 'https://api.coingecko.com/api/v3';
const SPOT_TTL_MS = 30_000;

// USD prices for ZEC and the tracked xStocks, from CoinGecko's keyless API.
export class Prices {
  #spot = { at: 0, quote: null };
  #history = new Map();

  // { ts, ZEC, AAPLX, TSLAX, ... } in USD.
  async spot() {
    if (Date.now() - this.#spot.at < SPOT_TTL_MS) return this.#spot.quote;
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
      this.#history.set(key, (await getJson(url)).prices);
    }
    return this.#history.get(key);
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`price feed ${res.status} for ${url}`);
  return res.json();
}
