# BuyWise AI

**Thoughtful purchasing. Enforced boundaries.**

BuyWise is a sandbox purchasing workspace for small teams. An AI assistant recommends office equipment; a user-confirmed **MANDATE** defines spending authority; **AgentGuard** checks the proposal independently; PayPal collects buyer approval and executes a sandbox payment.

The memorable demo: a malicious product listing asks for 50 keyboards from an unauthorized seller. AgentGuard rejects the labeled attack fixture before any PayPal request. The user then chooses a compliant alternative, approves in PayPal, and inspects the receipt and verified webhook.

## Current status — 8 November 2026

- Implemented: responsive workspace, mandate editor, fictional product catalog, Gemini adapter, deterministic policy checks, labeled attack lab, SQLite persistence, session isolation, PayPal Orders adapter, JavaScript SDK v6 integration, webhook postback verification, AG Grid Community ledger, audit timeline and setup screen.
- Verified locally: production build, automated policy/service tests, browser-based mandate creation, over-budget rejection, reservation, cancellation and attack demonstration.
- **Verified against providers on 5 November 2026:** Gemini recommended five Hush keyboards through the running app; the proposal passed the $300 mandate at $245. A separate PayPal sandbox test created and retrieved a matching $245 order. On 8 November, read-only PayPal sandbox lookups confirmed a completed $245 capture and its matching capture event against the locally webhook-verified purchase.
- No hosted deployment or public GitHub repository has been created yet. This source is prepared for publication under MIT.

The purchasing assistant now compares every candidate in the approved category in AG Grid. Each row shows its quantity-adjusted price, listing evidence for requested features, request budget and current mandate check. A search with no fitting product explains the constraint without offering a purchase.

## Run locally

The [6 November handbook audit](docs/HANDBOOK_AUDIT.md) maps all twelve P0 capabilities to observed results and open release gates. The [test plan](docs/TEST_PLAN.md) includes the browser acceptance command.

The [rules and prize review](docs/RULES_AND_PRIZES.md) maps submission requirements, sponsor choices and the no-cost boundary. AG Grid Community is the current sponsor target. Using a sponsor tool does not guarantee a prize. See [third-party notices](THIRD_PARTY_NOTICES.md).

Requirements: Node.js **22.13 or newer** (tested on 22.23.2), npm and an internet connection for installing dependencies. Node's built-in SQLite may print an experimental-feature warning on Node 22.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. No API keys are required to browse, confirm a mandate, reserve/cancel a purchase or run the attack fixture. Missing integrations show setup instructions; they never pretend a real AI call or payment succeeded.

On Windows, you can also double-click **START-BUYWISE.cmd**. It installs missing dependencies and starts the local app. Keep its window open while using BuyWise.

For a production build:

```sh
npm run build
npm start
```

### Configure the real integrations

Copy `.env.example` to `.env.local` in the project root, then edit that file locally. It is ignored by Git. Restart the app after changing values.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key from an eligible free-tier account |
| `GEMINI_MODEL` | An available model supporting structured JSON output in your account; do not enable paid billing |
| `PAYPAL_CLIENT_ID` | Sandbox REST app client ID; safe for the browser SDK |
| `PAYPAL_CLIENT_SECRET` | Sandbox REST app secret; server only |
| `PAYPAL_MERCHANT_ID` | Merchant/account ID of the sandbox business account owning that app; not its email |
| `PAYPAL_WEBHOOK_ID` | Webhook ID registered in that same sandbox app |
| `APP_URL` | Blank locally; exact public HTTPS origin when hosting, without a path |
| `DATABASE_PATH` | Defaults to `data/buywise.db`; use persistent storage when hosting |

1. Create a PayPal developer account and access its sandbox dashboard. Create a REST app plus separate sandbox business (seller) and personal (buyer) accounts. Copy the sandbox app credentials and seller merchant ID.
2. Create a free Gemini API key in Google AI Studio. Select an eligible available model with structured output support. Model availability and free quota vary; the app has no paid fallback. If access requires payment, stop and arrange an alternative free provider before claiming the AI integration works.
3. Confirm the mandate, then click **Find my best fit**. A real Gemini response must appear with its explanation and independent decision.
4. Review a compliant product. Click the PayPal button and sign in with the sandbox **buyer**, not the seller. Approve the payment. A successful capture shows the actual capture ID.
5. Configure HTTPS webhooks as below and verify a genuine capture event.

### Webhook setup

For the temporary local HTTPS demo, use the [ngrok setup and restart guide](docs/NGROK.md). It includes a script to register the listener and save its webhook ID without printing credentials.

PayPal must reach the app over HTTPS. For a local demo, use an approved HTTPS tunnel; for hosting, use a Node service with persistent disk. Register:

```text
https://YOUR-HOST/api/paypal/webhooks
```

Subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, and `PAYMENT.CAPTURE.DENIED` in the same sandbox app. Save the generated ID as `PAYPAL_WEBHOOK_ID`. Set `APP_URL` to the HTTPS origin and use that address in the browser.

BuyWise posts the event and signature headers to PayPal's verification endpoint, then retrieves the order independently and validates merchant, amount, currency, order reference and capture ID. Invalid or mismatched events cannot mark a purchase verified. Duplicate event IDs are deduplicated; payment amounts are counted from purchase state, not event count.

**PayPal simulator events do not support this postback verification method.** Use an actual sandbox capture for the final webhook acceptance check. The UI distinguishes capture confirmation from webhook verification. Refresh to see asynchronous updates.

## Architecture

```text
Browser (untrusted amounts and IDs)
  -> session + origin checks + input validation
  -> user-confirmed MANDATE
  -> server catalog -> Gemini JSON proposal (untrusted)
  -> AgentGuard deterministic evaluation
  -> transactional SQLite intent + budget reservation
  -> PayPal sandbox order -> buyer approval -> server capture
  -> verified webhook + order reconciliation -> audit ledger
```

- AI has no payment tools or secrets and cannot modify a mandate. It proposes a product ID, quantity and explanation.
- Server catalog data determines price, seller, currency, shipping and tax. The client and model cannot override them.
- All money is integer USD cents. The engine checks active/expiring mandate, positive integer quantity, stock, merchant, category, cumulative spend, pending reservations and per-purchase ceiling.
- SQLite transactions serialize reservations. One open purchase per session limits ambiguity. Mandates cannot change while budget is reserved.
- Create/capture operations use stable PayPal request IDs. Timeouts retain reservations until reconciliation; uncertain payments are never silently treated as failed.
- Sessions are random, server-stored and HttpOnly/SameSite. All user records are ownership-checked. Mutation routes enforce an explicit origin. Rate and input-size limits bound requests.
- The attack lab injects a labeled unsafe proposal directly. It proves the enforcement boundary, not that a model was actually compromised. Text-pattern detection is heuristic and not a universal injection defense.

### Important limits

This is a hackathon sandbox prototype, not production financial software. USD and one sandbox merchant only. Catalog items are fictional, with $0 shipping and tax, and no goods are fulfilled. The app does not purchase from arbitrary retailers. Channel3 is not integrated; its public discovery API does not establish authorization to collect a retailer's payments.

Anonymous sessions are a convenience for the demo, not user accounts or organization-wide budgets. Clearing cookies starts a separate workspace. There is no production identity, inventory allocation, refunds/disputes workflow, monitoring service or background reconciliation worker. The SQLite store is for a single persistent Node deployment; do not run independent database copies across replicas. Pending/unknown payments stay reserved until checked; exceptionally old uncertain order creation requires manual sandbox dashboard review. Never deploy this with live payment credentials.

## Tests

For a repeatable release check, install Microsoft Edge on Windows or Google Chrome on other platforms, then run:

```sh
npm run verify:release
```

This builds the app, starts it on port 3107 with a temporary database and provider credentials disabled, runs HTTP and browser checks, then stops that test server. Set `BROWSER_CHANNEL` to another installed Playwright-supported browser channel if needed. Port 3107 must be free, or set `RELEASE_TEST_PORT`. No browser download or paid service is triggered. The report is written to `artifacts/release-verification.json`. Live PayPal acceptance and submission publication are separate gates.

On 6 November this passed 52 unit/service tests, 13 production HTTP checks and browser acceptance including filtered AG Grid CSV download. Lint passed with existing warnings. Activity exports reflect the grid's active filters and include evidence hashes where recorded. CSV formula prefixes are escaped because listing and model text are untrusted.

```sh
npm test
npm run typecheck
npm run build
```

Policy and service tests use an isolated in-memory SQLite database and injected fake providers. They test overspend, malformed amounts/quantities, seller/category permissions, expired quotes, ownership, parallel/repeated requests, timeout recovery, cancellation, invalid signatures and webhook deduplication.

With a local server running, also run:

```sh
npm run test:http
```

This creates a separate test session and checks real HTTP routes, cookie protection, origin rejection, schema rejection and the no-credential setup path. It never makes a payment.

See [the acceptance checklist](docs/ACCEPTANCE.md) for the remaining real-provider checks, [the demo script](docs/DEMO_SCRIPT.md) for the 2m40s recording and [deployment guidance](docs/DEPLOYMENT.md).

## Project map

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` / `globals.css` | Responsive UI and PayPal SDK |
| `src/app/api/[...path]/route.ts` | API routing, session and request boundary |
| `src/core/policy.mjs` | Pure deterministic policy evaluator |
| `src/core/catalog.mjs` | Sandbox catalog, discovery, injection heuristics |
| `src/server/service.mjs` | Purchase lifecycle, reservations and reconciliation |
| `src/server/providers.mjs` | Gemini and PayPal sandbox HTTP adapters |
| `src/server/store.mjs` | SQLite storage and transactions |
| `tests/` | Isolated policy and service tests |

## Tools and attribution

Next.js, React and TypeScript power the app. Gemini provides recommendations when configured. PayPal Orders API and JavaScript SDK v6 handle sandbox approval/capture; PayPal Webhooks verifies asynchronous payment events. AG Grid **Community** displays sortable/filterable payment records. Lucide supplies interface icons. Product illustrations are original SVG shapes embedded in the source. DM Sans and Manrope are loaded from Google Fonts with local system fallbacks. No paid AG Grid features are used.

Official references: [PayPal checkout](https://developer.paypal.com/checkout/integrate), [Orders API](https://developer.paypal.com/api/orders/v2), [webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [hackathon rules](https://paypalaihackathon.devpost.com/rules).

MIT license. Preserve third-party package notices. AI-assisted implementation should be disclosed in the submission according to applicable event requirements.
