import { ZAT } from './config.js';
import { decodeMemo, verifyReceipt } from './memo.js';

// Rebuilds positions from the vault receipts a wallet received.
// Only receipts carrying a valid vault signature count; the rest are listed as rejected.
export function buildLedger(transfers, receiptKey) {
  const positions = {};
  const rejected = [];
  for (const t of transfers) {
    if (t.kind !== 'received') continue;
    for (const memo of t.memos ?? []) {
      const msg = decodeMemo(memo);
      if (!msg || (msg.type !== 'FILL' && msg.type !== 'CLOSE')) continue;
      if (!verifyReceipt(msg, receiptKey)) {
        rejected.push({ txid: t.txid, memo });
        continue;
      }
      applyReceipt((positions[msg.pos] ??= { pos: msg.pos, status: 'open' }), msg, t);
    }
  }
  return { positions: Object.values(positions).filter((p) => p.sym), rejected };
}

// Adds live value and P&L. `quote` is a Prices.spot() result.
export function markToMarket(positions, quote) {
  const totals = { costUsd: 0, valueUsd: 0, realizedUsd: 0, unrealizedUsd: 0, realizedZat: 0, stockBackUsd: 0 };
  for (const p of positions) {
    p.costUsd = p.qty * p.openPx;
    if (p.stockBack) totals.stockBackUsd += p.costUsd;
    if (p.status === 'closed') {
      p.pnlUsd = p.qty * (p.closePx - p.openPx);
      p.pnlZat = p.payout - p.stake;
      totals.realizedUsd += p.pnlUsd;
      totals.realizedZat += p.pnlZat;
    } else {
      p.lastPx = quote[p.sym];
      p.valueUsd = p.qty * p.lastPx;
      p.pnlUsd = p.valueUsd - p.costUsd;
      totals.costUsd += p.costUsd;
      totals.valueUsd += p.valueUsd;
      totals.unrealizedUsd += p.pnlUsd;
    }
  }
  totals.realizedZec = totals.realizedZat / ZAT;
  return totals;
}

function applyReceipt(p, msg, t) {
  const common = { sym: msg.sym, qty: Number(msg.qty) };
  if (msg.type === 'FILL') {
    Object.assign(p, common, {
      stake: Number(msg.stake),
      // A zero-stake fill is a stock-back reward: nothing was paid for it in ZEC.
      stockBack: Number(msg.stake) === 0,
      openPx: Number(msg.px),
      openZec: Number(msg.zec),
      openedAt: Number(msg.ts),
      fillTxid: t.txid,
    });
  } else {
    Object.assign(p, common, {
      status: 'closed',
      payout: Number(msg.payout),
      closePx: Number(msg.px),
      closeZec: Number(msg.zec),
      closedAt: Number(msg.ts),
      closeTxid: t.txid,
    });
  }
}
