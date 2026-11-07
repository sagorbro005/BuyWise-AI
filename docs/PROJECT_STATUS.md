# Project status on 8 November 2026

The comparison grid and no-match flow passed live Gemini browser checks at request budgets of $100 and $60. Two Shutter HD webcams cost $78. At $60 the UI showed an $18 shortfall and no purchase action. Release checks passed 61 unit/service tests and 13 HTTP checks.

Read-only PayPal sandbox lookups confirmed that a locally webhook-verified $245 purchase has a completed order, matching completed capture, correct merchant and matching PAYMENT.CAPTURE.COMPLETED event. Public repository, video and submission remain open.

## Earlier milestones

# Project status on 6 November 2026

Local MVP verified through live Gemini research, deterministic evaluation, reservation and PayPal sandbox order retrieval. The current milestone is buyer approval, capture and verified HTTPS webhook delivery. Release gate open. See the [feature-by-feature evidence](HANDBOOK_AUDIT.md) for validation results, stack differences and deliverables.

Rules review added sponsor decisions, third-party notices, filtered AG Grid CSV exports and a repeatable production acceptance command. `npm run verify:release` passed 52 tests, 13 HTTP checks and browser workflow/export checks on 6 November. No new service, trial, paid plan or public deployment was activated. Public repository, video, entrant attestations and Devpost submission remain open. See [rules and prizes](RULES_AND_PRIZES.md).

Later on 6 November, the requested ngrok HTTPS tunnel was activated and its listener registered in the existing PayPal sandbox app. APP_URL and PAYPAL_WEBHOOK_ID were saved locally. An optimized production server resolved public browser loading problems with the development build. Browser acceptance (mandate, attack, review, cancellation, audit and CSV) passed through the public link. All 12 applicable HTTP checks passed over both HTTPS and localhost, and 52 unit/service tests passed. Genuine buyer capture and signed payment-event delivery remain unverified. See [ngrok startup instructions](NGROK.md). The tunnel depends on this computer and both processes remaining online.
