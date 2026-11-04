import { homedir } from 'node:os';
import { join } from 'node:path';

export const ZINGO_CLI = process.env.ZINGO_CLI ?? join(homedir(), 'zk/zingolib/target/release/zingo-cli');
export const LIGHTWALLETD = process.env.LIGHTWALLETD ?? 'https://testnet.zec.rocks:443';
export const DATA_DIR = process.env.HF_DATA ?? join(process.cwd(), 'data');

export const VAULT_PORT = Number(process.env.VAULT_PORT ?? 7001);
export const APP_PORT = Number(process.env.APP_PORT ?? 7070);
export const VAULT_URL = process.env.VAULT_URL ?? `http://localhost:${VAULT_PORT}`;

export const ZAT = 100_000_000;
// Value carried by a receipt-only note. Zero-value shielded outputs are valid.
export const RECEIPT_ZAT = Number(process.env.RECEIPT_ZAT ?? 0);
// Value of the SELL instruction note the investor sends to the vault.
export const SELL_ZAT = Number(process.env.SELL_ZAT ?? 0);
// Receipts priced further than this from the public market fail the audit.
export const PRICE_TOLERANCE = 0.02;

// Tokenized stocks we track. xStocks trade 24/7, so prices are live outside US hours.
export const ASSETS = {
  AAPLX: { name: 'Apple', coingecko: 'apple-xstock' },
  TSLAX: { name: 'Tesla', coingecko: 'tesla-xstock' },
  NVDAX: { name: 'NVIDIA', coingecko: 'nvidia-xstock' },
  SPYX: { name: 'S&P 500', coingecko: 'sp500-xstock' },
};
export const ZEC = { name: 'Zcash', coingecko: 'zcash' };
