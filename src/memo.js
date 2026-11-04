import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Hushfolio memo protocol v1: pipe-separated ASCII inside a 512-byte Zcash memo.
//   investor -> vault:  BUY, SELL, REWARD  (instructions)
//   vault -> investor:  FILL, CLOSE, REFUND  (receipts, signed by the vault)
const TAG = 'HF1';
const FIELDS = {
  BUY: ['sym', 'claim', 'reply'],
  SELL: ['pos', 'secret', 'reply'],
  REWARD: ['invoice', 'claim', 'reply'],
  FILL: ['pos', 'sym', 'qty', 'px', 'zec', 'ts', 'stake', 'claim'],
  CLOSE: ['pos', 'sym', 'qty', 'px', 'zec', 'ts', 'payout'],
  REFUND: ['ref', 'reason', 'amount'],
};
const SIGNED = new Set(['FILL', 'CLOSE', 'REFUND']);
const MEMO_BYTES = 512;

export function encodeMemo(type, data) {
  const memo = [TAG, type, ...FIELDS[type].map((k) => String(data[k]))].join('|');
  if (Buffer.byteLength(memo) > MEMO_BYTES) throw new Error(`${type} memo exceeds ${MEMO_BYTES} bytes`);
  return memo;
}

// Returns { type, body, sig, ...fields } or null for anything that isn't ours.
export function decodeMemo(memo) {
  const parts = memo.trim().split('|');
  const [tag, type] = parts;
  if (tag !== TAG || !FIELDS[type]) return null;
  const names = FIELDS[type];
  const signed = SIGNED.has(type);
  if (parts.length !== 2 + names.length + (signed ? 1 : 0)) return null;
  const msg = { type, body: parts.slice(0, 2 + names.length).join('|') };
  names.forEach((k, i) => (msg[k] = parts[2 + i]));
  if (signed) msg.sig = parts.at(-1);
  return msg;
}

export function verifyReceipt(msg, publicKey) {
  if (!msg?.sig) return false;
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(msg.body), key, Buffer.from(msg.sig, 'base64url'));
}

// A position's sell right: the vault keeps the hash, the investor keeps the secret.
export function claimOf(secret) {
  return createHash('sha256').update(secret).digest('hex').slice(0, 32);
}

// The vault's ed25519 key for signing receipts.
export class ReceiptSigner {
  constructor(privateKey) {
    this.privateKey = privateKey;
    this.publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  }

  static loadOrCreate(path) {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    }
    return new ReceiptSigner(createPrivateKey(readFileSync(path)));
  }

  sign(type, data) {
    const body = encodeMemo(type, data);
    const sig = sign(null, Buffer.from(body), this.privateKey).toString('base64url');
    const memo = `${body}|${sig}`;
    if (Buffer.byteLength(memo) > MEMO_BYTES) throw new Error(`signed ${type} memo exceeds ${MEMO_BYTES} bytes`);
    return memo;
  }
}
