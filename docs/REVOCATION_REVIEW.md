# Mandate enforcement review — 7 November 2026

AgentGuard checks recommendations, new reservations, new order creation and capture initiation automatically. The attack button is a labeled demonstration fixture. Checks include more than ten possible failure reasons and do not guarantee detection of every malicious text.

Revocation immediately marks the stored mandate inactive and versions it. Unused reserved and order-created purchases are canceled locally. Creating, capture-pending and review-required states retain their reservations until their outcome is resolved. Revocation cannot retract a capture request already dispatched to PayPal and does not refund completed payments. Confirming a new mandate does not revive canceled purchases or erase completed spending.

Normal mandate editing is blocked while funds are reserved. A stale tab may still display its previous checkout until it refreshes, but server checks enforce current state before new spending. The UI now refreshes on focus and every 15 seconds, disables revoked/expired purchase controls, hides checkout for unusable mandates and labels reactivation Confirm mandate. Denied recommendations disable their review button. The backend remains the authority even if UI state is stale.

Repeated order creation now checks current policy before returning an existing uncompleted order. A canceled order cannot reopen checkout. Returning a previously captured result is idempotent readback. Recovery of an uncertain order creation can retry the same provider request ID after quote expiry to identify the original order; this is not new capture authorization. Capture still checks the mandate and quote. Existing provider orders cannot be erased by a local revocation.

Errors depend on the state. A new reservation under a revoked mandate produces MANDATE_INACTIVE. An already canceled intent can instead report that checkout or capture is unavailable. Expired quotes report QUOTE_EXPIRED, while expired mandates report MANDATE_EXPIRED. These are intentional distinctions.

New regression scenarios cover unused reservation revocation, approved-order revocation, stale existing-order checks, revocation during creation, revocation during approval retrieval, and revocation after capture dispatch. Browser acceptance covers revocation from another tab and reactivation.

Live sandbox buyer approval, capture and signed webhook delivery are separate acceptance gates. Automated provider tests do not establish their completion.

Validation on 7 November: 58 unit/service tests passed, production compilation and TypeScript validation passed, and 13 isolated production HTTP checks passed. The initial cross-tab browser test exposed a test-harness restriction (an implicit one-page browser context). After switching to an explicit browser context, browser acceptance passed against the updated local production app, including cross-tab revocation, disabled controls and reactivation. Lint completed with existing warnings. The local app was restarted with these changes. No real payment was initiated by these tests.

## Git workflow

Local Git was initialized on 7 November. There was no pre-existing repository or commit history. No history is invented for earlier work. Before each commit, present the exact proposed message and scope to the user and wait for explicit approval. Do not commit or publish automatically. Exclude environment secrets, local databases, build outputs and generated artifacts. GitHub setup is deferred at the user's request.
