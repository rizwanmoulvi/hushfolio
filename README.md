# Hushfolio

**Own Apple, Tesla and the S&P 500 without the world, or even your broker, seeing your portfolio. Shielded ZEC in, shielded ZEC out, and one viewing key for your accountant.**

**Live app (Zcash testnet):** https://hushfolio-ten.vercel.app · **Demo video:** https://youtu.be/Q6GEWDKTkro

Visitors can browse the real portfolio, see what the vault sees, and run the viewing-key audit live. Buying, selling and spending need the operator key: every sale triggers a real Bitrefill purchase, so a public button would let anyone drain the credits.

Built at the Free Society Hackathon (Mumbai, 4 Nov 2026) for the **Privacy track**. Runs on Zcash testnet with NU7.

## The problem

Tokenized stocks (xStocks on Solana, Robinhood's EU tokens on Arbitrum, Ondo, Dinari) sit on public chains. Anyone can read a wallet's whole portfolio, its position sizes and its trade timing. Zcash can't hold those tokens yet, because Zcash Shielded Assets haven't shipped. Routing ZEC to a stock token through a bridge only hides the funding source: the position is still public on the other chain.

## What Hushfolio does instead

The position lives inside Zcash's shielded pool as a pair of encrypted memos.

```
 investor wallet                    shielded pool                    vault
 ───────────────                    ─────────────                    ─────
 BUY  AAPLX, claim=H(secret),  ──▶  note + encrypted memo  ──▶  fills at live xStock price
      reply=<fresh address>                                     (no idea who sent it)
                               ◀──  note + encrypted memo  ◀──  FILL receipt, ed25519-signed
 SELL pos, secret,             ──▶  note + encrypted memo  ──▶  checks H(secret) = claim
      reply=<another fresh one>
                               ◀──  ZEC payout + memo      ◀──  CLOSE receipt, signed
```

1. **Buy.** You send shielded ZEC (TAZ on testnet) to the vault. The encrypted memo names the stock, a hash of a sell secret only you hold, and a **fresh one-time reply address**.
2. **Fill.** The vault prices the order at the live market price of the matching tokenized stock (Apple xStock, and so on) and returns a **signed FILL receipt** in a shielded memo.
3. **Portfolio.** Your app rebuilds your positions from the receipts your wallet received. No one else can.
4. **Sell.** You reveal the sell secret, again with a fresh reply address. The vault pays out quantity × current price in shielded ZEC with a signed CLOSE receipt.
5. **Prove it.** You export your **unified full viewing key**. The accountant's tool loads it into a view-only wallet and checks:
   - every receipt is signed by the vault's published key (forged receipts are rejected),
   - each receipt's stake matches the investor's own outgoing BUY note,
   - each fill and exit price is within 2% of the public market price at that minute.

   It then reports realized and unrealized P&L. The viewing key can't spend, and it can't sell either: sell secrets never go on chain.

## Spend from a sale: the Bitrefill agent (Agentic Commerce track)

When a position closes, an agent turns part of the sale into everyday spending in India, with no prompt and no human checkout. The **trigger** is the vault's signed CLOSE receipt arriving in your shielded wallet. The **budget** comes from that receipt. The **purchase** is a real order through Bitrefill's REST API.

- **Rule, set once:** buy a Flipkart ₹50 gift card with up to 5% of each verified sale. The product, value and share are configurable (`REWARD_PRODUCT`, `REWARD_VALUE`, `SPEND_SHARE`).
- **Guardrails:**
  - *The most the agent can spend:* the lower of 5% of the sale's signed proceeds and **$5 per purchase**.
  - *Who approves above that:* purchases up to **$1** go through automatically. Between $1 and $5, the investor approves or declines in the app. Above the budget or above $5, nothing is bought.
  - Each sale can trigger at most one purchase. The agent runs one pass at a time and records each attempt before buying, so it never fires twice.
  - Delivered codes are masked on screen and in storage. Full codes stay in your Bitrefill account.
- **Bitrefill surfaces used:** REST API v2 (`/products/{id}` for live pricing, `POST /invoices` with `payment_method: balance` and `auto_pay`, then `/invoices/{id}` and `/orders/{id}` polled until the order is delivered).
- **Built vs reused:** we built the trigger (the shielded receipt), the receipt-bound budget, the guardrails and the approval flow. We reused Bitrefill's catalog, invoices and fulfillment.
- **Honest gap:** testnet TAZ can't pay Bitrefill, and Bitrefill doesn't accept ZEC, so purchases are paid from Bitrefill event credits. On mainnet the vault's payout would go shielded ZEC → NEAR Intents → USDC → Bitrefill, which only exists on mainnet.

### Stock-back: earn the stock of the brands you shop

Every delivered card earns a shielded position in the stock of the company behind the brand, worth **5% of what was paid** (`STOCK_BACK_RATE`). We, the operator, fund it for now.

| Bitrefill product | Stock-back in | Why |
| --- | --- | --- |
| `flipkart-india` | WMTX (Walmart) | Walmart owns Flipkart |
| `amazon-fresh-india` | AMZNX (Amazon) | |
| `google-play-india` | GOOGLX (Alphabet) | |

How it works:
1. After delivery, the app sends the vault a shielded `REWARD` memo carrying the invoice ID, a hash-locked sell claim, and a fresh one-time reply address.
2. The vault looks the invoice up on our Bitrefill account. It checks that the product maps to a stock, that the order was delivered, and that this invoice hasn't been rewarded before.
3. It then sends back a signed FILL receipt with zero stake.

The reward is an ordinary position: it shows in the portfolio tagged *stock-back*, it can be sold for shielded ZEC, and the accountant's audit matches it to the investor's own `REWARD` request instead of a BUY.

**Tested on testnet, both ways:** a real delivered purchase (Bitrefill's free test card, invoice `f96cff4d-…`) earned 0.00402643 WMTX (see Evidence), and a `REWARD` request for an invoice that doesn't exist (tx `a3e26d4994fa174e51cd837a428a0533fd9b4fd35a42eb60d476b4e62fe447c8`) was correctly rejected by the vault after it checked Bitrefill.

**Next:** fund the reward from Bitrefill's affiliate commission (invoices already carry `payment.commission`) instead of from the vault.

**Which parts are for which track:**
- Privacy track: the vault, the memo protocol, fresh reply addresses, sell rights only the investor can use, and the viewing-key audit.
- Agentic Commerce track: `src/spender.js` and `src/bitrefill.js`, stock-back (`REWARD` in `src/vault.js`), and the "Spend from a sale" panel in the app.
- The privacy note below covers both.

## Privacy and trust note

**What stays private**
- On-chain: everything. Order sizes, assets, prices, P&L, sender and receiver are inside shielded notes and encrypted memos. An observer sees shielded transactions and nothing else.
- From the vault (the counterparty): who you are and which positions belong together. A shielded note carries no sender address, and each order names a different one-time reply address, so the vault holds a book of positions with no owners.
- From the auditor: nothing until you hand over the key, and they can't spend with it.

**What the app reveals, and to whom**
- The vault sees each order's asset, size and timing, but not who placed it. It could still guess links from timing, for example two orders placed seconds apart.
- The light-wallet server (`testnet.zec.rocks`) sees the wallet's IP address and sync pattern. The zingo-cli 8.0 default routes all of this through the **Nym mixnet**, and Hushfolio works with it. At the venue, Nym couldn't find a working exit node, so the demo build talks to the light-wallet server directly (`nakednet-test-mode`). Set `ZINGO_CLI` to the default build to restore mixnet transport.
- Price lookups go to CoinGecko from the vault and the auditor, never from the investor's wallet.
- A full viewing key shows the auditor *everything* this wallet did, not just Hushfolio trades. To limit that, use a wallet dedicated to Hushfolio.

**What users have to trust**
- **The vault operator**, most of all. Positions are synthetic: the vault owes you the price move and holds your ZEC to cover it. On mainnet, this is the slot a licensed issuer or a NEAR Intents route to real xStocks would fill. The signed receipts make a cheating vault provable but not impossible.
- **The vault's receipt key.** The auditor fetches it from the vault's published endpoint.
- **Bitrefill**, for the spending agent. Bitrefill sees the purchase and the account it's paid from, but nothing on Zcash. The sale that triggered it stays shielded.
- **Stock-back:** the vault checks the Bitrefill invoice before paying the reward, so it learns which purchase earned which reward position, but still not who you are.
- **CoinGecko** as the price source for fills and audits. Pyth's Hermes, a signed oracle, would be better, but it has required an API key since August 2026.
- **zingolib / zingo-cli 8.0** as the wallet.

**What we'd fix next**
- Replace the custodial vault with a FROST multisig, so no single operator holds the funds.
- Take fill prices from Pyth, a signed oracle, so the receipt carries the oracle's proof instead of the vault's word.
- Disclose single payments instead of the whole viewing key, so an accountant sees only Hushfolio trades.
- Move the position itself on chain when Zcash Shielded Assets ship: a real shielded zAAPL instead of a memo-backed claim.
- Batch and delay vault replies, to remove the timing link between an order and its fill.

## Run it (about 10 minutes)

Requirements: Node 22 or later, Rust, and testnet TAZ from a faucet ([Fauzec](https://fauzec.com/) or [Valar](https://faucet.testnet.valargroup.dev/)).

```bash
# 1. Build the wallet (zingolib 8.0, NU7-ready)
git clone --depth 1 --branch zingolib_v8.0.0 https://github.com/zingolabs/zingolib ~/zk/zingolib
cd ~/zk/zingolib
cargo build --release -p zingo-cli                                                  # mixnet (default)
cargo build --release -p zingo-netutils --features nym --bin nym-proxy
# or, where Nym can't find an exit:
cargo build --release -p zingo-cli --no-default-features --features nakednet-test-mode --target-dir target-direct

# 2. Run the vault and the investor app
cd hushfolio
export ZINGO_CLI=~/zk/zingolib/target-direct/release/zingo-cli                   # only for the direct build
npm run vault     # prints the vault address; fund it with TAZ
npm run app       # http://localhost:7070; fund the investor address it shows

# Optional: the Bitrefill agent. Put BITREFILL_API_KEY=... in .env (git-ignored)

# Command-line flow
node src/cli.js buy AAPLX 0.01
node src/cli.js portfolio
node src/cli.js sell <position>
node src/cli.js disclose && node src/cli.js audit disclosure.json
npm test
```

## Deployment

- **AWS EC2** (Ubuntu 26.04, t3.micro) runs the vault and the investor app as systemd services (`hushfolio-vault`, `hushfolio-app`), with a Linux `zingo-cli` built in Docker (`rust:1-bookworm`, `--no-default-features --features nakednet-test-mode`).
- **Vercel** serves the HTTPS domain and proxies every request to the EC2 app (`vercel.json` rewrite).
- Settings in `.env`: `BITREFILL_API_KEY`; `HF_ADMIN_TOKEN` (an operator opens `/?key=<token>` once to unlock trading); `COINGECKO_API_KEY` (optional, a free demo key that avoids rate limits on cloud IPs).
- `scripts/snapshot.sh` builds a static, read-only copy of the app from real data, as a fallback that needs no server.

## Technology and design decisions

- **zingo-cli 8.0** (zingolib) drives both wallets. It handles NU7, the Ironwood pool, and loading a wallet from a viewing key alone, which the auditor's view-only wallet needs. It's called one command at a time, through a per-wallet queue. Local reads run with `--offline`, so they take milliseconds.
- **The memo protocol `HF1`** is pipe-separated ASCII under Zcash's 512-byte memo limit. Vault receipts carry an ed25519 signature (Node's built-in crypto).
- **Hash-locked sell rights.** The vault stores `sha256(secret)`; only the investor's app holds the secret. That's why a viewing key can read positions but can't sell them.
- **Prices:** CoinGecko's keyless API for the xStock tokens (AAPLX, TSLAX, NVDAX, SPYX, which trade 24/7) and ZEC/USD. Testnet TAZ is valued at the mainnet ZEC price for the demo.
- **No dependencies.** Node's standard library and a static HTML/JS page.

| File | Role |
| --- | --- |
| `src/vault.js` | Counterparty loop: reads orders, fills them, signs receipts, pays out |
| `src/investor.js` | Buy and sell with fresh reply addresses, portfolio, viewing-key export |
| `src/auditor.js` | View-only wallet from the viewing key; signature, stake and price checks |
| `src/memo.js` | `HF1` memo format and receipt signatures |
| `src/ledger.js` | Rebuilds positions and P&L from receipts |
| `src/zingo.js` | zingo-cli wrapper |
| `src/spender.js` | Bitrefill agent: receipt-triggered, budgeted and approval-gated purchases |
| `src/bitrefill.js` | Bitrefill REST v2 client |
| `web/` | The UI: portfolio, the vault's view, the accountant flow |

## Evidence (Zcash testnet, 4 Nov 2026)

| Step | Transaction |
| --- | --- |
| Shielded BUY, 0.05 TAZ → AAPLX | `87bf3613228a8d9bee13306b019b47aca5b45cf8112fbb12c5052030077c8c14` |
| Vault FILL receipt: 0.18782938 AAPLX at $340.41 | `2d9750d00932e0097970568cfc010c26eac6b52e6c042dede291363d1bc7c5bf` |
| Shielded SELL: hash-locked secret revealed | `c508fefb62bdea338a29daec735c0bb11935fc6756ac739e951016cc45619d5a` |
| Vault CLOSE: paid 0.05018718 TAZ | `cd9dbeddd49c7273d1a01cc6c69c54f120f2e3fe0f4d59453444bb15d58ca5c8` |

Later, on the EC2 deployment (recorded in the walkthrough video):

| Step | Evidence |
| --- | --- |
| Shielded BUY, 0.01 TAZ → NVDAX, filled at $203.69 | fill tx `4a7873b3c7696d839ff346b2433a2cfdb2aa16e725d0597f6b7221964e68a04d` |
| SELL of WMTX, vault paid 0.009945 TAZ | close tx `8a7cb8aee44142ad64a498fa56b20b14284ba5a5e3c56895e033941f76328798` |
| **Agent's own Bitrefill purchase**, triggered by that sale: Bitrefill's free test gift card, delivered | invoice `f96cff4d-56af-40a4-bc23-1945bc7eb16d` |
| **Stock-back**: vault verified the invoice, issued 0.00402643 WMTX | fill tx `361eaa7a9f2f6e55b5eecb78e4058fef6b4f084adcaaaa7622580869cf82f351` |
| Audit of all 6 positions, including stock-back matched to its invoice | passed |

The first audit, run in a fresh view-only wallet from the viewing key alone, passed: the signature, stake, entry price (0.08% from market) and exit price (0.41% from market) all checked out. Realized: +$0.20 (+0.00018718 TAZ).

## Next 30 days

See *What we'd fix next* above. First milestone: Pyth-signed fill prices plus single-payment disclosure.
