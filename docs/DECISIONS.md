# Architecture decisions

The earlier project plan selected a single local Node service with SQLite, anonymous browser workspaces, a synthetic catalog and Gemini. This review retains those choices to preserve the existing ledger and the reproducible zero-cost setup. The handbook proposes Supabase or local PostgreSQL, membership and RLS. Moving the ledger requires a migration and separate concurrency, ownership and persistence tests.

The app uses custom responsive CSS, Node's test runner, Biome and Playwright Core with an installed browser. Channel3 and Render are conditional integrations. No account entitlement for either was verified during this review. The sandbox merchant is the only payable seller. The user can include or exclude it.

The original schedule sets an earlier internal submission target than the handbook. Keep the earlier buffer. The official deadline recorded in the project is 13 November at 02:00 Dhaka time.
