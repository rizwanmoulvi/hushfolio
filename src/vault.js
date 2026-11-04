import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ASSETS, DATA_DIR, RECEIPT_ZAT, ZAT } from './config.js';
import { ReceiptSigner, claimOf, decodeMemo } from './memo.js';
import { Prices } from './prices.js';
import { JsonStore } from './store.js';
import { Zingo } from './zingo.js';

// The counterparty. It watches its shielded address for BUY and SELL memos,
// fills them at the live xStock price and answers with signed receipts.
// It never learns who an investor is: shielded notes carry no sender, and
// every order names a fresh one-time reply address.
export class Vault {
  constructor() {
    const dir = join(DATA_DIR, 'vault');
    this.wallet = new Zingo(dir);
    this.signer = ReceiptSigner.loadOrCreate(join(dir, 'receipt-key.pem'));
    this.store = new JsonStore(join(dir, 'state.json'), { processed: {}, positions: {} });
    this.prices = new Prices();
    this.log = [];
  }

  async info() {
    const [address] = await this.wallet.addresses();
    return { address, receiptKey: this.signer.publicKey, assets: ASSETS };
  }

  // What the vault itself can see: positions keyed by order, never by person.
  book() {
    return { positions: Object.values(this.store.data.positions), log: this.log.slice(-50) };
  }

  async run(intervalMs = 15_000) {
    for (;;) {
      try {
        await this.tick();
      } catch (err) {
        this.#note(`tick failed: ${err.message}`);
      }
      await sleep(intervalMs);
    }
  }

  async tick() {
    const transfers = await this.wallet.messages();
    for (const t of transfers) {
      if (t.kind !== 'received' || t.status !== 'confirmed') continue;
      if (this.store.data.processed[t.txid]) continue;
      const msg = (t.memos ?? []).map(decodeMemo).find((m) => m?.type === 'BUY' || m?.type === 'SELL');
      if (msg) await (msg.type === 'BUY' ? this.#fill(t, msg) : this.#close(t, msg));
    }
  }

  async #fill(t, msg) {
    if (!ASSETS[msg.sym]) return this.#refund(t, msg.reply, 'unknown-asset');
    const quote = await this.prices.spot();
    const qty = ((t.value / ZAT) * quote.ZEC) / quote[msg.sym];
    const receipt = {
      pos: t.txid.slice(0, 16),
      sym: msg.sym,
      qty: qty.toFixed(8),
      px: quote[msg.sym],
      zec: quote.ZEC,
      ts: quote.ts,
      stake: t.value,
      claim: msg.claim,
    };
    const txid = await this.wallet.send([
      { address: msg.reply, amount: RECEIPT_ZAT, memo: this.signer.sign('FILL', receipt) },
    ]);
    this.store.data.positions[receipt.pos] = { ...receipt, status: 'open', fillTxid: txid };
    this.#done(t, `FILL ${receipt.pos} ${receipt.qty} ${receipt.sym} @ $${receipt.px}`, txid);
  }

  async #close(t, msg) {
    const p = this.store.data.positions[msg.pos];
    if (!p || p.status !== 'open' || claimOf(msg.secret) !== p.claim) {
      return this.#done(t, `REJECT sell of ${msg.pos}: unknown, closed or wrong secret`, null);
    }
    const quote = await this.prices.spot();
    const payout = Math.floor(((Number(p.qty) * quote[p.sym]) / quote.ZEC) * ZAT);
    const receipt = { pos: msg.pos, sym: p.sym, qty: p.qty, px: quote[p.sym], zec: quote.ZEC, ts: quote.ts, payout };
    const txid = await this.wallet.send([
      { address: msg.reply, amount: payout, memo: this.signer.sign('CLOSE', receipt) },
    ]);
    Object.assign(p, { status: 'closed', closePx: receipt.px, payout, closeTxid: txid });
    this.#done(t, `CLOSE ${msg.pos} paid ${payout / ZAT} TAZ`, txid);
  }

  async #refund(t, reply, reason) {
    const memo = this.signer.sign('REFUND', { ref: t.txid.slice(0, 16), reason, amount: t.value });
    const txid = await this.wallet.send([{ address: reply, amount: t.value, memo }]);
    this.#done(t, `REFUND ${t.txid.slice(0, 16)}: ${reason}`, txid);
  }

  #done(t, what, replyTxid) {
    this.store.data.processed[t.txid] = { what, replyTxid, at: new Date().toISOString() };
    this.store.save();
    this.#note(`${what}${replyTxid ? ` -> ${replyTxid}` : ''}`);
  }

  #note(line) {
    const entry = `${new Date().toISOString()} ${line}`;
    this.log.push(entry);
    console.log(`[vault] ${entry}`);
  }
}
