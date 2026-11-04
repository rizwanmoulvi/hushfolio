#!/usr/bin/env node
import './env.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_PORT, VAULT_PORT, VAULT_URL } from './config.js';
import { Auditor } from './auditor.js';
import { serve } from './http.js';
import { Investor } from './investor.js';
import { Bitrefill } from './bitrefill.js';
import { GainsSpender } from './spender.js';
import { Vault } from './vault.js';

// On a public server, actions that move money need the operator's token; reading and auditing stay open.
const ADMIN_TOKEN = process.env.HF_ADMIN_TOKEN;
const guarded = (fn) => (body) => {
  if (ADMIN_TOKEN && body.token !== ADMIN_TOKEN) {
    throw new Error('This public server is read-only for visitors: buying, selling and spending need the operator key.');
  }
  return fn(body);
};

const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));
const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

const commands = {
  // Counterparty service: order loop + public info on VAULT_PORT.
  async vault() {
    const vault = new Vault();
    print(await vault.info());
    serve(VAULT_PORT, { 'GET /vault': () => vault.info(), 'GET /vault/book': () => vault.book() });
    await vault.run();
  },

  // Investor app (API + web UI) on APP_PORT. The auditor view is served too, for the demo.
  async app() {
    const investor = new Investor();
    const auditor = new Auditor();
    const spender =
      process.env.BITREFILL_API_KEY &&
      new GainsSpender(new Bitrefill(), investor.prices, (purchase) => investor.claimReward(purchase.invoiceId));
    serve(
      APP_PORT,
      {
        'GET /api/account': () => investor.account(),
        'GET /api/portfolio': async () => {
          const portfolio = await investor.portfolio();
          spender?.onPortfolio(portfolio.positions).catch((err) => console.error('[spender]', err.message));
          return portfolio;
        },
        'GET /api/spend': async () => ({
          enabled: Boolean(spender),
          ...(spender ? { ...spender.state(), balance: await spender.bitrefill.balance() } : {}),
        }),
        'POST /api/spend/approve': guarded(({ pos }) => spender.approve(pos)),
        'POST /api/spend/decline': guarded(({ pos }) => spender.decline(pos)),
        'POST /api/spend/retry': guarded(({ pos }) => spender.retry(pos)),
        'POST /api/stockback': guarded(({ invoice }) => investor.claimReward(invoice)),
        'GET /api/quote': () => investor.prices.spot(),
        'POST /api/buy': guarded(({ sym, zec }) => investor.buy(sym, Number(zec))),
        'POST /api/sell': guarded(({ pos }) => investor.sell(pos)),
        'POST /api/disclose': () => investor.disclose(),
        'GET /api/vault-book': async () => (await fetch(`${VAULT_URL}/vault/book`)).json(),
        // Visitors may audit any viewing key, but only against this server's own vault.
        'POST /api/audit': ({ ufvk, birthday }) => auditor.audit({ ufvk, birthday, vault: VAULT_URL }),
      },
      WEB_DIR,
    );
  },

  account: () => new Investor().account().then(print),
  portfolio: () => new Investor().portfolio().then(print),
  buy: (sym, zec) => new Investor().buy(sym, Number(zec)).then(print),
  sell: (pos) => new Investor().sell(pos).then(print),
  stockback: (invoice) => new Investor().claimReward(invoice).then(print),
  async disclose(out = 'disclosure.json') {
    writeFileSync(out, JSON.stringify(await new Investor().disclose(), null, 2), { mode: 0o600 });
    print(`viewing-key disclosure written to ${out}`);
  },
  audit: (file = 'disclosure.json') => new Auditor().audit(JSON.parse(readFileSync(file, 'utf8'))).then(print),
};

const [name, ...args] = process.argv.slice(2);
if (!commands[name]) {
  print(`usage: node src/cli.js <${Object.keys(commands).join('|')}> [args]`);
  process.exit(1);
}
await commands[name](...args);
