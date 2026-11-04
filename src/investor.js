import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ASSETS, DATA_DIR, SELL_ZAT, VAULT_URL, ZAT } from './config.js';
import { buildLedger, markToMarket } from './ledger.js';
import { claimOf, encodeMemo } from './memo.js';
import { Prices } from './prices.js';
import { JsonStore } from './store.js';
import { Zingo } from './zingo.js';

// The investor's own app. Keys, sell secrets and the portfolio stay on this machine.
export class Investor {
  constructor() {
    const dir = join(DATA_DIR, 'investor');
    this.wallet = new Zingo(dir);
    this.store = new JsonStore(join(dir, 'orders.json'), { orders: {} });
    this.prices = new Prices();
  }

  async vault() {
    this.vaultInfo ??= await (await fetch(`${VAULT_URL}/vault`)).json();
    return this.vaultInfo;
  }

  async account() {
    const [address] = await this.wallet.addresses();
    const balance = await this.wallet.call('balance', [], { sync: false });
    return { address, balance };
  }

  async buy(sym, zec) {
    if (!ASSETS[sym]) throw new Error(`unknown asset ${sym}`);
    const vault = await this.vault();
    const secret = randomBytes(16).toString('hex');
    const reply = await this.wallet.newAddress();
    const memo = encodeMemo('BUY', { sym, claim: claimOf(secret), reply });
    const txid = await this.wallet.send([{ address: vault.address, amount: Math.round(zec * ZAT), memo }]);
    this.#remember(txid.slice(0, 16), { txid, sym, secret, reply, at: Date.now() });
    return { pos: txid.slice(0, 16), txid };
  }

  async sell(pos) {
    const order = this.store.data.orders[pos];
    if (!order) throw new Error(`no sell secret for position ${pos}`);
    const vault = await this.vault();
    const reply = await this.wallet.newAddress();
    const memo = encodeMemo('SELL', { pos, secret: order.secret, reply });
    const txid = await this.wallet.send([{ address: vault.address, amount: SELL_ZAT, memo }]);
    this.#remember(pos, { ...order, sellTxid: txid });
    return { pos, txid };
  }

  async portfolio() {
    const [vault, transfers, quote] = await Promise.all([this.vault(), this.wallet.messages(), this.prices.spot()]);
    if (!Array.isArray(transfers)) throw new Error(String(transfers).slice(0, 300));
    const { positions, rejected } = buildLedger(transfers, vault.receiptKey);
    const totals = markToMarket(positions, quote);
    return { positions, pending: this.#pending(positions), totals, rejected: rejected.length, quote };
  }

  // Everything an accountant needs, and nothing that can spend.
  async disclose() {
    const { ufvk, birthday } = await this.wallet.call('export_ufvk', [], { sync: false });
    return { ufvk, birthday, vault: VAULT_URL, createdAt: new Date().toISOString() };
  }

  // Orders sent but not yet answered by a vault receipt.
  #pending(positions) {
    const byPos = new Map(positions.map((p) => [p.pos, p]));
    return Object.entries(this.store.data.orders).flatMap(([pos, o]) => {
      const p = byPos.get(pos);
      if (!p) return [{ pos, sym: o.sym, side: 'BUY', txid: o.txid }];
      if (o.sellTxid && p.status === 'open') return [{ pos, sym: o.sym, side: 'SELL', txid: o.sellTxid }];
      return [];
    });
  }

  #remember(pos, order) {
    this.store.data.orders[pos] = order;
    this.store.save();
  }
}
