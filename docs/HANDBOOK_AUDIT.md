# Implementation handbook review

Reviewed 6 November 2026 against the supplied *BuyWise AI Zero Cost Implementation Handbook*. The local demo passes through real sandbox order creation. Release acceptance is open at buyer approval, capture and genuine webhook delivery. A successful provider-contract test alone cannot close those gates.

| Handbook ID | Current implementation and acceptance evidence |
| --- | --- |
| F01 Workspace | Local Next.js app starts with its current session, mandate, balances, catalog and activity. Exercised through Edge in a fresh session. Workspace isolation is anonymous and browser-specific. |
| F02 MANDATE | The form submits a name, total budget, separate transaction cap, quantity, category, allowed demo merchant and validity in hours. The server validates bounds, computes the UTC expiry, versions updates and supports revocation. Buyer approval is mandatory. There is one eligible merchant and one category per mandate. Browser setup and service rejection tests passed. |
| F03 Purchasing agent | A real Gemini call extracted quiet wireless keyboards, five units, USD 25,000 cents and shared-office requirements. The response passed server schema validation. The agent's recommendation is associated with a server-owned research ID and the applicable mandate version. The stated request can further restrict spending. |
| F04 Discovery | The backend searches the labeled fictional inventory and inspects descriptions. The handbook permits this fallback. Channel3 is outside the tested configuration. Product artwork is drawn locally. Prices and stock are synthetic fixtures without live retrieval times. |
| F05 Comparison | Product cards show unit and quantity-adjusted prices. Gemini receives catalog facts and returns a comparison explanation. The connected run selected five Hush 75 keyboards at $245. The offer list uses text relevance and price. Model prose is advisory and its factual accuracy cannot be guaranteed for every query. |
| F06 AgentGuard | Policy tests cover amount, merchant, item, category, quantity, stock, currency, budget limits, expiry, revocation and outstanding reservations. The payment service resolves trusted values on the server. Research IDs are ownership-checked and stale recommendations require new research. Suspicious content alone requires review and keeps checkout closed. |
| F07 Security Lab | The explicitly labeled malicious listing causes a denied decision with its listing text, signals and failed rules. Browser and service tests show the refusal and no payment call. The attack is supplied as a fixture. |
| F08 Human review | A browser test reached the exact five-item $245 purchase review and canceled it. The screen identifies item, sandbox merchant, mandate version and budget reservation. Actual PayPal buyer interaction is a separate open gate. |
| F09 Orders v2 | On 6 Nov, the running app passed a real AI recommendation through reservation, created an order and retrieved it from PayPal sandbox. The server matched amount, merchant and reference. The local intent was then canceled. |
| F10 Checkout and capture | Implemented SDK buyer flow, server approval and quote checks, idempotent capture and reconciliation. Mocked success, failure and timeout tests pass. Real sandbox buyer approval and confirmed capture remain open. |
| F11 Webhooks | Signature postback, order lookup, capture validation and event deduplication are implemented. A verified approval event records approval separately from spending. Unit and HTTP rejection tests pass. A registered HTTPS listener and genuine signed sandbox delivery remain open. |
| F12 Audit | AG Grid Community provides a sortable/filterable purchase ledger with order/capture IDs and a searchable audit/security table. Detailed policy events include evidence and SHA-256 comparisons. Browser search passed. Real verified payment history awaits F10–F11. Historical events retain the evidence originally recorded. |

## Other handbook sections

| Sections | Finding |
| --- | --- |
| 1, 3.2–3.3 | Local SQLite, custom CSS and Node's test runner are implementation differences from the proposed stack. See DECISIONS.md. Account billing and quota limits require owner-side evidence. |
| 3.1, 4–5 | The model receives policy fields and synthetic catalog data. PayPal secrets and anonymous session credentials stay outside the prompt. Protected browser responses remove the session identifier. Transactions reserve money atomically. A normal workspace read or a new reservation releases an expired, uncaptured quote. An uncertain capture remains reserved. |
| 6 | Product operations are controlled by server code. The model has no callable payment tools. Search and recommendation run in a single workflow. A quota or provider failure allows manual catalog browsing. A runnable Ollama adapter is outside the current build. |
| 7 | PayPal sandbox, CAPTURE intent and postback signature verification are implemented. The handler sends the parsed event to PayPal for verification. It does not implement a separate raw-body cryptographic verifier. Register CHECKOUT.ORDER.APPROVED and all three capture events documented in README. |
| 8 | The API uses consolidated routes and a session-owned SQLite document store. PostgreSQL foreign keys, Supabase membership/RLS and the exact suggested URL layout are absent. Epoch timestamps represent UTC instants. Public application routes expose no direct audit-write operation. A research ID identifies the AI run. Per-request correlation IDs and a normalized payment schema remain differences. |
| 9 | Workspace, mandate, attack lab, approval, settings and audit are reachable in the local UI. Some screens share a page. A fresh desktop browser exercised the revised controls. Earlier builds passed phone and dark-theme checks. |
| 10–11 | Production build, type checking, service tests, real HTTP routes and a browser acceptance test were exercised. The browser test covers local purchase review through cancellation. Buyer approval and webhook delivery require a separate connected run. |
| 12–13, 16 | Local judge instructions, license, source archive and evidence exist. Public hosting, repository URL, authenticated organizational identities and durable hosted storage remain open. No cloud migration or billing change was performed during the review. |
| 14–15, 18 | Demo script and release checklist exist. Public YouTube video, entrant IP attestations, sponsor eligibility, Devpost URLs and submission confirmation require independent completion. |

## Optional features

New mandate versions, proposal snapshots, reservation balances and grid filters are available. Versions created before history tracking can only be preserved when their data still exists. Purchase and filtered audit CSV exports were added and browser-tested during the rules review. A dedicated version-history screen, what-if simulator and downloadable confirmed receipt are outside the tested build. The handbook defers these until P0 passes.

## Quality checks

On 6 Nov, 51 service, policy and adapter tests passed, alongside 12 applicable HTTP checks. The browser test passed against the running app. The production build compiled and passed TypeScript validation. Biome lint exited successfully with warnings and informational findings. Ten production JavaScript chunks were checked for the configured Gemini key and PayPal client secret, with zero matches. This check covers those specific values and build files.

The local state check counted zero completed capture receipts and zero verified completed payments. PAYPAL_WEBHOOK_ID was unset. A recorded sandbox buyer flow with the resulting capture and verified event on the same order is the next release gate.

Later on 6 November, `npm run verify:release` passed 52 tests, 13 HTTP checks and browser acceptance against an isolated production server. This additionally covers filtered CSV export and spreadsheet-formula protection. See RULES_AND_PRIZES.md for remaining submission gates. This run made no provider calls.
