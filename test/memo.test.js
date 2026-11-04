import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { buildLedger, markToMarket } from '../src/ledger.js';
import { ReceiptSigner, claimOf, decodeMemo, encodeMemo, verifyReceipt } from '../src/memo.js';

const signer = new ReceiptSigner(generateKeyPairSync('ed25519').privateKey);
const reply = 'utest1' + 'q'.repeat(200);

test('BUY memo round-trips and fits a Zcash memo', () => {
  const memo = encodeMemo('BUY', { sym: 'AAPLX', claim: claimOf('s3cret'), reply });
  assert.ok(Buffer.byteLength(memo) <= 512);
  assert.equal(decodeMemo(memo).reply, reply);
});

test('signed receipts verify, tampered ones do not', () => {
  const memo = signer.sign('FILL', { pos: 'ab'.repeat(8), sym: 'AAPLX', qty: '0.03800000', px: 337.94, zec: 1286.5, ts: 1793800000, stake: 1000000, claim: claimOf('x') });
  assert.ok(verifyReceipt(decodeMemo(memo), signer.publicKey));
  assert.ok(!verifyReceipt(decodeMemo(memo.replace('337.94', '137.94')), signer.publicKey));
  const other = new ReceiptSigner(generateKeyPairSync('ed25519').privateKey);
  assert.ok(!verifyReceipt(decodeMemo(memo), other.publicKey));
});

test('ledger rebuilds a round trip and its P&L', () => {
  const pos = 'cd'.repeat(8);
  const fill = signer.sign('FILL', { pos, sym: 'TSLAX', qty: '1', px: 100, zec: 1000, ts: 1, stake: 10_000_000, claim: 'c' });
  const close = signer.sign('CLOSE', { pos, sym: 'TSLAX', qty: '1', px: 110, zec: 1000, ts: 2, payout: 11_000_000 });
  const forged = new ReceiptSigner(generateKeyPairSync('ed25519').privateKey).sign('CLOSE', { pos, sym: 'TSLAX', qty: '1', px: 999, zec: 1, ts: 3, payout: 1 });
  const transfers = [
    { kind: 'received', txid: 't1', memos: [fill] },
    { kind: 'received', txid: 't2', memos: [close] },
    { kind: 'received', txid: 't3', memos: [forged] },
    { kind: 'sent', txid: 't4', memos: ['hello'] },
  ];
  const { positions, rejected } = buildLedger(transfers, signer.publicKey);
  assert.equal(positions.length, 1);
  assert.equal(rejected.length, 1);
  const totals = markToMarket(positions, { TSLAX: 120 });
  assert.equal(positions[0].pnlUsd, 10);
  assert.equal(totals.realizedZat, 1_000_000);
});
