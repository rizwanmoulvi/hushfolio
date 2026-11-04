# Hushfolio

**Own Apple, Tesla and the S&P 500 without the world, or even your broker, seeing your portfolio. Shielded ZEC in, shielded ZEC out, and one viewing key for your accountant.**

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

# Command-line flow
node src/cli.js buy AAPLX 0.01
node src/cli.js portfolio
node src/cli.js sell <position>
node src/cli.js disclose && node src/cli.js audit disclosure.json
npm test
```

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
| `web/` | The UI: portfolio, the vault's view, the accountant flow |

## Next 30 days

See *What we'd fix next* above. First milestone: Pyth-signed fill prices plus single-payment disclosure.
