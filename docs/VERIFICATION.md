# Verification record — 5 November 2026

Environment: Windows, Node 22.23.2, Next.js 16.4.5, React 19.3.1. Dependencies installed from npm; installation audit reported no vulnerabilities.

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 45 passed, 0 failed | Policy, provider contracts and service lifecycle with mocked external services |
| `npm run build` | Passed | Production compilation, TypeScript validation and route generation |
| `npm run test:http` | 13 passed | Real local API routes, session cookies, origin enforcement, schema validation, reservation/cancellation, unsigned webhook rejection |
| Browser desktop | Passed observed flow | Mandate, overspend rejection, $245 reservation, cancellation, attack lab, ledger, setup screen |
| Browser phone viewport | No horizontal overflow | 390px viewport; responsive mandate, cards and navigation |
| Browser console | No captured errors/warnings during checked UI flow | Not a full accessibility or performance audit |
| Gemini live call | Passed | Running app used gemini-3.5-flash-lite; five Hush keyboards, $245, policy allowed |
| PayPal sandbox order | Passed | Created and retrieved; merchant, reference and $245 total matched |
| PayPal buyer approval/capture | Not run | Needs sandbox buyer interaction |
| Actual signed PayPal webhook | Not run | Needs sandbox credentials and reachable HTTPS listener |
| Public hosting/repository/video | Not published | Requires user accounts and real-provider acceptance tests |

Subsequent six-feature review: 46 automated tests passed. All 12 applicable HTTP checks passed with AI configured. The earlier 13-check run also exercised missing-key handling. New evaluations at recommendation, attack test, purchase review, order creation and capture retain the decision-time rules, catalog quote, proposal, budget inputs, inspection findings and policy result. Activity recalculates the SHA-256 checksums on read. Older events have their original summaries only. A party with write access to both records and checksums could replace both. These checks do not provide an independently anchored audit log.

The browser test found and fixed a localhost versus 127.0.0.1 origin mismatch. An AG Grid boolean auto-renderer was changed so webhook status is textual rather than an ambiguous checkbox. Webhook deduplication is committed atomically with its state update. Uncertain order creation reuses its request ID within a bounded recovery period; capture still requires an unexpired quote.

The saved workspace screenshot is a real local browser capture. It shows AI setup needed, zero completed payments and a labeled attack-test count. No fake integration success is seeded into the application.
