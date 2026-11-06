# BuyWise AI: zero-budget implementation plan

Prepared 5 November 2026 (Asia/Dhaka). Updated status: runnable local application implemented, production build passed, 45 automated tests and 13 HTTP checks passed. See docs/VERIFICATION.md. Live integrations still require the user's credentials; no public deployment or repository yet.

## Deadline and constraints

Official deadline: 13 November 2026, 02:00 Dhaka (12 November, noon PST). At the initial check there were about 8 days and 29 minutes left. Internal submission target: 12 November, 02:00 Dhaka. Keep the final 24 hours for unexpected problems.

One student, little coding experience, no existing accounts or API credentials, zero spending. Daily availability is unconfirmed; provisionally allow 2–3 hours/day of user setup, review and demo work. Engineering estimates below are focused work estimates, not guarantees of unattended progress.

## Fixed product and acceptance criteria

BuyWise helps a small team purchase office equipment. A user confirms a MANDATE: USD budget, maximum quantity, allowed merchant, allowed product category, expiration, and required buyer approval. AI searches a small catalog, compares candidates and proposes a purchase. AgentGuard validates it using server-owned data. PayPal handles buyer approval and sandbox payment.

One demo: request five keyboards within $300; show a deliberately malicious listing and an unsafe proposal being rejected; choose a legitimate alternative; approve in PayPal; capture; show the receipt and verified webhook in an audit timeline. A deliberately supplied unsafe proposal must be labeled as an attack test, not passed off as a spontaneous AI failure.

Done means real AI inference plus a real sandbox payment, not a scripted imitation. No money or physical goods move. Catalog merchants are explicitly fictional sandbox merchants. External retail offers, if enabled, are research links only.

## Technology and cost decisions

| Area | Decision | Gate/fallback |
| --- | --- | --- |
| App | Next.js, TypeScript, Node.js; one app and server | Node 22 and npm already available |
| Payments | PayPal Orders v2 REST + JavaScript SDK + verified webhooks | Free sandbox developer access must work on day 1 |
| AI | Gemini API free tier, schema-constrained proposals | Confirm eligible account, free model and actual quota before selecting model; never enable billing. If unavailable, assess a local model against machine resources |
| Catalog | Server-owned seeded office-equipment catalog | Always available; honest sandbox labeling |
| External discovery | Optional Channel3 search/lookup | Only after a free access test; maximum 90 minutes integration effort |
| Persistence | SQLite locally with transactional reservations | Hosted adapter only after a durable free store is verified |
| Dashboard | AG Grid Community, basic filtering/sorting and audit detail | MIT-licensed Community features only |
| Tests | Node tests initially; integration tests and Playwright when app exists | Test payment boundaries and races, not just visual snapshots |
| Distribution | Public GitHub repo, MIT license, exact setup instructions | Account setup and secret scan before publication |
| Hosting | Optional free Render web service | Free local runnable submission is the guaranteed distribution path; evaluate durable storage before deployment |

OpenAI was the earlier proposal, but this plan does not depend on paid API credits. Do not confuse a chat subscription with application API access. No paid domains, paid databases, paid grid license, browser agents, or additional sponsor integrations.

Render free Postgres expires after 30 days, which would not cover the full December judging period if created now. Do not use it as the only copy of demo state. A local build with complete instructions is explicitly allowed by the rules. For local sandbox webhook testing, select and verify a free HTTPS tunnel before configuring the listener; a tunnel is not an always-available hosted demo.

## Architecture and trust boundaries

Browser -> authenticated/session-bound Next.js routes -> catalog + AI proposal adapter -> AgentGuard -> persisted purchase intent -> PayPal order -> buyer approval -> server capture -> verified webhook reconciliation.

1. Browser submits the shopping request. A separate form shows the MANDATE for explicit user confirmation. AI may suggest rules but cannot silently authorize them.
2. Catalog adapter returns product IDs and descriptions. Descriptions are untrusted data. The AI receives no API secrets, payment tools, arbitrary HTTP fetch tool, or ability to update MANDATE.
3. AI returns only a bounded proposal (product ID, quantity, explanation). Schema validation rejects unknown fields, malformed output, refusals and incomplete responses. Application resolves merchant, unit price, currency, stock, tax and shipping itself.
4. AgentGuard flags suspicious descriptions for review/quarantine. Pattern detection is advisory and incomplete. Deterministic checks enforce known product, approved merchant/category, USD currency, positive integer quantity, final total in integer cents, remaining budget and expiry regardless of detection results.
5. A DB transaction reserves budget and stores an immutable priced intent, policy version and quote expiry. Row-level ownership checks protect every route. Use session cookies, CSRF/origin checks, rate limits and bounded input lengths.
6. Create-order accepts an intent ID, never a browser-supplied price or payee. Only the configured sandbox merchant is used. Repeated clicks reuse the persisted operation and PayPal request identifier.
7. JavaScript SDK opens PayPal buyer approval. The server checks ownership, current policy, reservation and order details again before capture. Changed policies or quotes require a new intent/approval.
8. Capture timeouts enter an unresolved state and are reconciled against PayPal; do not release budget or create a second purchase while outcome is unknown. Idempotent retries prevent duplicate charges.
9. Webhook route verifies with PayPal using the configured webhook ID. Only verified, matching order/capture/amount/currency/payee events update payment state. Deduplicate event IDs and tolerate out-of-order arrival. Store receipt state separately from webhook verification status.
10. Dashboard reads persisted events, including policy rejection reasons, reserved/spent budget and payment reconciliation status. Never show green payment success based solely on a browser callback.

Core records: Session, Mandate, CatalogProduct, PurchaseIntent, BudgetReservation, PaymentOperation, WebhookEvent, AuditEvent. Payment states: proposed, blocked, reserved, order_created, capture_pending, captured, failed, canceled; webhook confirmation is a separate field. Unknown payment outcomes remain reserved pending reconciliation.

Routes: POST /api/mandates; POST /api/agent/propose; POST /api/intents; POST /api/paypal/orders; POST /api/paypal/orders/:id/capture; POST /api/paypal/webhooks; GET /api/dashboard. No route accepts arbitrary model-selected payment recipients.

## Time boxes and exit gates

| Dhaka date | Focused engineering budget | Deliverable / exit gate |
| --- | --- | --- |
| Nov 5 | 4 h | Accounts/access tests; policy foundation; app shell. Confirm PayPal developer access and one free AI request. User work: 60–90 min setup |
| Nov 6 | 6 h | Server-owned catalog, saved mandate, one real sandbox order/approval/capture. Start HTTPS webhook setup early |
| Nov 7 | 5 h | Real AI search/ranking + structured proposal; optional Channel3 only if free access works |
| Nov 8 | 6 h | Durable intents/reservations, idempotency, verified webhook reconciliation, ownership protection |
| Nov 9 | 4 h | Coherent shopping flow, blocked attack explanation, budget and audit dashboard |
| Nov 10 | 5 h | Security/payment integration tests, optional free deployment, clean-machine setup verification |
| Nov 11 | 4 h | Feature freeze; README/license; public repo; record 2m40s demo; submission draft |
| Nov 12 before 02:00 | 2 h | Submit; check public repository, public YouTube video, runnable instructions and URLs |

Total estimate: 36 focused engineering hours plus account setup and review. If available time is materially lower, cut Channel3 and hosted deployment first, then dashboard embellishments. Never cut real AI, real PayPal approval/capture, deterministic checks, or submission deliverables. No subscriptions, multi-seller payouts, autonomous checkout, vector database, agent swarm, mobile app or production money movement.

Account-access decision gate: if PayPal sandbox access fails, resolve with official support/hackathon organizers immediately; do not fabricate a payment integration. If free AI access fails, check a viable local model before spending UI time. The project cannot satisfy the promised demo with both integrations simulated.

## Verification plan

- Policy: exact budget boundary, overspend, cumulative reserved spend, unknown merchant/product, wrong category/currency, negative/fractional/excess quantity, expired or revoked mandate, numeric overflow, shipping/tax included.
- Security: malicious product text cannot change mandate, payee or amount; unsafe model proposal is blocked even when text detector misses it; client price tampering and cross-session intent access fail.
- Payments: repeated create/capture, parallel requests, failed approval, denied/pending capture, timeout after PayPal succeeds, expired reservation, changed policy and mismatched order details.
- Webhooks: invalid signature cannot mutate state; duplicate and out-of-order events do not double-count; mismatched amount/currency/payee/order rejected; actual sandbox event tested. PayPal simulator events do not support postback signature verification.
- End to end: new visitor -> mandate -> AI recommendation -> block example -> valid purchase -> PayPal approval -> capture -> verified event -> receipt. Record which checks are mocked and which ran against real services.
- Delivery: no secrets or user payment details in repo/logs/video; license visible; new checkout installs and starts; missing-key UI explains setup; quota failure is honest and never silently substitutes fake AI.

## Demo, 2 minutes 40 seconds

- 0:00–0:15: A team wants five keyboards within $300; explain delegated purchasing risk.
- 0:15–0:35: Confirm MANDATE and show AI comparison.
- 0:35–1:05: Run clearly labeled attack test; show rejected proposal, exact reasons and no PayPal order created.
- 1:05–1:55: Safe alternative, buyer approval in PayPal sandbox and real capture.
- 1:55–2:20: Receipt, verified webhook, remaining budget and audit history.
- 2:20–2:40: Architecture, current limits, repository and practical impact. Do not claim injection-proof security or checkout at arbitrary retailers.

## User setup checklist

1. Register/join the hackathon and create/sign in to GitHub.
2. Open PayPal Developer, verify sandbox dashboard access, create a REST sandbox app and separate business/seller and personal/buyer test accounts. Use test accounts only.
3. Open Google AI Studio and check whether a Gemini API key is available under the free tier without billing. If payment is requested, stop that setup path and report the screen text.
4. Keep secrets out of chat. We will provide local ignored environment-file fields for the PayPal secret, Gemini key and later webhook ID. Never commit them.
5. Tell the assistant daily time availability and any account-access obstacle. The assistant handles implementation; the user handles personal logins, account verification, buyer approval, reviewing the demo and final submission.

## Official sources checked 5 November 2026

- Rules/deadline/submission: https://paypalaihackathon.devpost.com/rules
- PayPal checkout: https://developer.paypal.com/checkout/integrate
- Orders: https://developer.paypal.com/api/orders/v2
- Sandbox: https://developer.paypal.com/sandbox-testing/overview
- Webhook verification/simulator limitations: https://developer.paypal.com/api/rest/webhooks/rest/
- Gemini free-tier pricing (account/model availability still needs a real test): https://ai.google.dev/gemini-api/docs/pricing
- Channel3 discovery and coming-soon checkout: https://trychannel3.com/developers
- AG Grid Community license: https://www.ag-grid.com/react-data-grid/community-vs-enterprise/
- Render Next.js: https://render.com/docs/deploy-nextjs-app
- Render free-instance limits: https://render.com/docs/free
