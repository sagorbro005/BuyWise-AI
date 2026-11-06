# Repeatable acceptance tests

Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. With the app running locally, run `npm run test:http` and `npm run test:e2e`. The latter launches an installed Edge browser on Windows or Chrome elsewhere. Override the browser using BROWSER_CHANNEL. Both local acceptance scripts create isolated demo workspaces.

The suite checks policy limits, quote expiry, revocation, retained mandate versions, request-specific caps, ownership, concurrent order creation, duplicate callbacks, capture timeouts, verified approval events, rejected signatures and audit evidence. The browser path covers a manual purchase review and cancellation. Use the [handbook audit](HANDBOOK_AUDIT.md) for actual results and [acceptance checklist](ACCEPTANCE.md) for the buyer-driven connected test.
