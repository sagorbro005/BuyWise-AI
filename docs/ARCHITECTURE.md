# Application architecture

The browser sends a shopping request and separately confirms financial permissions. The Node service searches seeded products, requests structured output from Gemini and resolves the selected item against trusted catalog data. It stores the proposal, parsed request and mandate version. AgentGuard checks quantity, seller, category, time, price and available funds. A transaction records an allowed reservation or a rejected decision.

PayPal receives server-calculated USD amounts and a fixed sandbox payee. Buyer approval occurs in the JavaScript SDK. Server capture checks the PayPal order, current mandate and immutable quote. Signed event processing uses verification postback, authoritative order retrieval and idempotent SQLite writes. Receipt capture and webhook confirmation appear separately in the ledger.

Implementation paths and endpoint setup are documented in [README](../README.md). Stack differences are recorded in [DECISIONS](DECISIONS.md).
