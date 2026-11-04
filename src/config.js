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
  AMZNX: { name: 'Amazon', coingecko: 'amazon-xstock' },
  WMTX: { name: 'Walmart', coingecko: 'walmart-xstock' },
  GOOGLX: { name: 'Alphabet', coingecko: 'alphabet-xstock' },
};

// Stock-back: a delivered Bitrefill purchase earns the brand owner's tokenized stock.
// Flipkart is owned by Walmart, so a Flipkart card earns Walmart.
export const STOCK_BACK = {
  'flipkart-india': 'WMTX',
  'amazon-fresh-india': 'AMZNX',
  'google-play-india': 'GOOGLX',
  // Bitrefill's free test card, mapped so the whole loop can run without credits.
  'test-gift-card-code': 'WMTX',
};
// Share of the purchase price paid back in stock. Funded by the vault operator for now.
export const STOCK_BACK_RATE = Number(process.env.STOCK_BACK_RATE ?? 0.05);
export const ZEC = { name: 'Zcash', coingecko: 'zcash' };
