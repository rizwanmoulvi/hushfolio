import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, PRICE_TOLERANCE } from './config.js';
import { buildLedger, markToMarket } from './ledger.js';
import { decodeMemo } from './memo.js';
import { Prices } from './prices.js';
import { Zingo } from './zingo.js';

// Turns a viewing key into a verified trade report. The auditor's wallet is
// view-only: it can read the investor's shielded history but never spend.
export class Auditor {
  constructor() {
    this.prices = new Prices();
  }

  async audit({ ufvk, birthday, vault }) {
    const receiptKey = (await (await fetch(`${vault}/vault`)).json()).receiptKey;
    const dir = join(DATA_DIR, 'audit', createHash('sha256').update(ufvk).digest('hex').slice(0, 12));
    const wallet = new Zingo(dir, { viewkey: ufvk, birthday });
    const transfers = await wallet.messages();

    const { positions, rejected } = buildLedger(transfers, receiptKey);
    const buys = sentBuys(transfers);
    for (const p of positions) p.checks = await this.#check(p, buys);
    const totals = markToMarket(positions, await this.prices.spot());
    const passed = positions.every((p) => Object.values(p.checks).every((c) => c.ok));
    return { passed, positions, totals, rejected, receiptKey, auditedAt: new Date().toISOString() };
  }

  async #check(p, buys) {
    const order = buys.get(p.pos);
    const checks = {
      signature: { ok: true, detail: 'signed by the vault receipt key' },
      stake: p.stockBack
        ? {
            ok: order?.type === 'REWARD',
            detail: order ? `stock-back for Bitrefill invoice ${order.invoice}` : 'no matching REWARD request in this wallet',
          }
        : {
            ok: order?.type === 'BUY' && order.value === p.stake,
            detail: order ? `BUY tx ${order.txid.slice(0, 12)}… sent ${order.value} zat` : 'no matching BUY in this wallet',
          },
      openPrice: await this.#priceCheck(p.sym, p.openPx, p.openedAt),
    };
    if (p.status === 'closed') checks.closePrice = await this.#priceCheck(p.sym, p.closePx, p.closedAt);
    return checks;
  }

  // Re-prices a fill against the public market at the receipt's own timestamp.
  async #priceCheck(sym, px, ts) {
    try {
      const market = await this.prices.at(sym, ts);
      const drift = Math.abs(px - market) / market;
      return { ok: drift <= PRICE_TOLERANCE, detail: `receipt $${px} vs market $${market.toFixed(2)} (${(drift * 100).toFixed(2)}%)` };
    } catch (err) {
      return { ok: false, detail: `could not fetch market price: ${err.message}` };
    }
  }
}

// The investor's own BUY and REWARD requests, visible to a full viewing key as outgoing notes.
function sentBuys(transfers) {
  const orders = new Map();
  for (const t of transfers) {
    if (t.kind !== 'sent') continue;
    const msg = (t.memos ?? []).map(decodeMemo).find((m) => m?.type === 'BUY' || m?.type === 'REWARD');
    if (msg) orders.set(t.txid.slice(0, 16), { txid: t.txid, value: t.value, type: msg.type, invoice: msg.invoice });
  }
  return orders;
}
