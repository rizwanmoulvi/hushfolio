# Feedback

Notes from building Hushfolio in one day. Each item says what we hit and what would have helped.

## Bitrefill

1. **The `country` filter on product search didn't filter.** `GET /v2/products/search?q=airtel&country=IN` returned Airtel Nigeria, Uganda and Kenya ahead of Airtel India. We filtered on the client side by `country_code` and by `india` in the product id.
2. **Prices come back in satoshis while the account balance is in BTC.** This isn't obvious from the response: `price: 702` on a ₹50 card has no unit next to it. An agent that budgets in USD has to fetch a BTC/USD rate from somewhere else. A `price_usd` field, or a unit next to `price`, would remove a whole dependency.
3. **`package_id` vs `value`.** The OpenAPI spec types `products[].package_id` as a number, but package ids in the catalog are strings like `swiggy-money-india<&>50`. We ended up sending `value: 50`, which worked. One sentence in the invoice docs on which field to use for package (non-range) products would have saved trial and error.
4. **`balance_too_low` was a good error.** It was clear, machine-readable, and arrived before any invoice was left dangling. Our agent records it and offers a retry once credit arrives. More errors like this, please.
5. **Test products worked well once we found them.** `include_test_products=true` plus `payment_method: balance` bought and delivered `test-gift-card-code` on an account with 0 balance. Our hackathon pack said test products stay hidden until Bitrefill enables them for the account, which sent us chasing credits for hours. The docs page is right; the pack wasn't.
6. **No sandbox balance for real products.** Test products cover the API loop, but an agent that budgets against real catalog prices (a ₹50 Flipkart card) can't complete a purchase until someone hands over credits. A small self-serve test balance for new keys would let teams try the real catalog before asking.
7. **There's no "private by default" route yet.** Lane 5 rightly says ZEC isn't accepted, and the only path, NEAR Intents 1Click, has no testnet. For a privacy-track team, that means the payment leg can't be shown working on testnet. Accepting shielded ZEC directly, even only for top-ups and gift cards, would make Bitrefill the obvious place to spend shielded money.

## Zcash tooling (optional notes for the Privacy track)

1. **zingo-cli 8.0 requires the Nym mixnet for any online session.** This is great for privacy, but on the venue WiFi the proxy kept failing with `no proven exit: 6 births each proved nothing within 3500ms`, and syncs hung for more than 8 minutes. The only fallback is rebuilding with `--no-default-features --features nakednet-test-mode`. A runtime flag for "this session, without the mixnet, I accept the risk" would help builders on bad networks.
2. **Killing a zingo-cli process during a mixnet sync left the wallet unable to finish a later sync**, even after we switched to a direct connection. Restoring from the seed into a new data directory fixed it in 11 seconds.
3. **Output formats are mixed.** `messages` returns JSON wrapped in `{"value_transfers": [...]}`, `balance` prints `key: value` lines with `100_000_000`-style numbers, and `recovery_info` prints JSON-like text that isn't valid JSON. A `--json` flag on every command would make zingo-cli much easier to script.
4. **Pyth Hermes now needs an API key** (since August 2026). We switched to CoinGecko's keyless API for the xStock prices.
5. **What worked well:** the builder pack's "Doesn't work on NU7" list saved us hours. zingolib 8.0 built cleanly. `--offline` mode makes local reads take milliseconds. Zero-value shielded outputs carrying signed memos worked on the first try.

## From the human on the team

*(To be filled in by the human on the team: what slowed you down, in your own words.)*
