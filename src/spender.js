import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DATA_DIR } from './config.js';
import { JsonStore } from './store.js';

// Guardrails, set once by the investor.
export const RULES = {
  // Share of each verified sale the agent may turn into everyday spending.
  proceedsShare: Number(process.env.SPEND_SHARE ?? 0.05),
  // At or below this, the agent buys on its own. Above it, the investor approves in the app.
  autoApproveUsd: Number(process.env.AUTO_APPROVE_USD ?? 1),
  // Hard ceiling per purchase, approval or not.
  maxPurchaseUsd: Number(process.env.MAX_PURCHASE_USD ?? 5),
  reward: {
    productId: process.env.REWARD_PRODUCT ?? 'flipkart-india',
    value: Number(process.env.REWARD_VALUE ?? 50),
    label: process.env.REWARD_LABEL ?? 'Flipkart ₹50',
  },
};

const DELIVERY_POLLS = 20;

// "Spend from a sale": when a position closes, the agent buys the investor's chosen
// reward on Bitrefill, sized by the sale's signed CLOSE receipt, never by a prompt.
export class GainsSpender {
  // onDelivered(record) runs after a purchase is delivered; the app uses it to claim stock-back.
  constructor(bitrefill, prices, onDelivered) {
    this.bitrefill = bitrefill;
    this.prices = prices;
    this.onDelivered = onDelivered;
    this.store = new JsonStore(join(DATA_DIR, 'investor', 'spend.json'), { purchases: {}, approvals: {} });
  }

  state() {
    const { purchases, approvals } = this.store.data;
    return { rules: RULES, purchases: Object.values(purchases), approvals: Object.values(approvals) };
  }

  // Called after every portfolio sync with the verified positions. Runs one pass at
  // a time and records every outcome first, so a sale can never trigger two purchases.
  async onPortfolio(positions) {
    if (this.running) return;
    this.running = true;
    try {
      for (const p of positions) {
        if (p.status !== 'closed' || this.#seen(p.pos)) continue;
        await this.#consider(p).catch((err) => this.#record({ pos: p.pos, sym: p.sym, error: err.message }, 'failed'));
      }
    } finally {
      this.running = false;
    }
  }

  async approve(pos) {
    const pending = this.store.data.approvals[pos];
    if (!pending) throw new Error(`nothing awaiting approval for ${pos}`);
    delete this.store.data.approvals[pos];
    return this.#purchase(pending, 'investor');
  }

  // A failed purchase (e.g. no Bitrefill credit yet) is reconsidered on the next sync.
  retry(pos) {
    if (this.store.data.purchases[pos]?.status !== 'failed') throw new Error(`${pos} has no failed purchase`);
    delete this.store.data.purchases[pos];
    this.store.save();
    return { pos, status: 'will retry on next sync' };
  }

  decline(pos) {
    const pending = this.store.data.approvals[pos];
    if (!pending) throw new Error(`nothing awaiting approval for ${pos}`);
    delete this.store.data.approvals[pos];
    this.store.data.purchases[pos] = { ...pending, status: 'declined' };
    this.store.save();
  }

  async #consider(p) {
    const budgetUsd = (p.payout / 1e8) * p.closeZec * RULES.proceedsShare;
    const priceUsd = await this.#rewardPriceUsd();
    const plan = { pos: p.pos, sym: p.sym, budgetUsd, priceUsd, reward: RULES.reward.label, at: new Date().toISOString() };
    if (priceUsd > budgetUsd || priceUsd > RULES.maxPurchaseUsd) return this.#record(plan, 'over-budget');
    if (priceUsd > RULES.autoApproveUsd) {
      this.store.data.approvals[p.pos] = { ...plan, status: 'awaiting-approval' };
      return this.store.save();
    }
    return this.#purchase(plan, 'agent');
  }

  async #purchase(plan, approvedBy) {
    this.#record({ ...plan, approvedBy }, 'buying');
    const invoice = await this.bitrefill.buy(RULES.reward);
    const record = { ...plan, approvedBy, invoiceId: invoice.id, status: invoice.status };
    this.#record(record, invoice.status);
    return this.#awaitDelivery(record);
  }

  // Paid is not delivered: poll until the order has redemption details.
  async #awaitDelivery(record) {
    for (let i = 0; i < DELIVERY_POLLS; i++) {
      const invoice = await this.bitrefill.invoice(record.invoiceId);
      const orderId = invoice.orders?.[0]?.id;
      const order = orderId && (await this.bitrefill.order(orderId));
      if (order?.status === 'delivered') {
        const delivered = this.#record({ ...record, orderId, redemption: mask(order.redemption_info) }, 'delivered');
        return this.#claimStockBack(delivered);
      }
      this.#record({ ...record, orderId }, invoice.status);
      await sleep(3000);
    }
    return this.store.data.purchases[record.pos];
  }

  async #claimStockBack(record) {
    if (!this.onDelivered) return record;
    try {
      const { pos } = await this.onDelivered(record);
      return this.#record({ ...record, stockBackPos: pos }, 'delivered');
    } catch (err) {
      return this.#record({ ...record, stockBackError: err.message }, 'delivered');
    }
  }

  async #rewardPriceUsd() {
    // Bitrefill's test products are free: their listed price is never charged.
    if (RULES.reward.productId.startsWith('test-')) return 0;
    const product = await this.bitrefill.product(RULES.reward.productId);
    const pkg = product.packages?.find((x) => String(x.value) === String(RULES.reward.value));
    if (!pkg) throw new Error(`no ${RULES.reward.value} package on ${RULES.reward.productId}`);
    return (pkg.price / 1e8) * (await this.prices.usd('bitcoin'));
  }

  #seen(pos) {
    return this.store.data.purchases[pos] || this.store.data.approvals[pos];
  }

  #record(entry, status) {
    this.store.data.purchases[entry.pos] = { ...entry, status };
    this.store.save();
    return this.store.data.purchases[entry.pos];
  }
}

// Codes are cash: keep only enough to recognise one on screen.
function mask(info = {}) {
  const code = info.code ?? info.pin ?? info.link ?? '';
  return { hint: code ? `${String(code).slice(0, 3)}••••${String(code).slice(-2)}` : 'see Bitrefill order', instructions: info.instructions };
}
