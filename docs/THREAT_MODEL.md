# Demo threat model

| Threat | Control and remaining exposure |
| --- | --- |
| Malicious seller text or unsafe model output | Pattern inspection, strict response schema and independent server policy. Pattern matching cannot discover every attack. A user should inspect the interpreted request and explanation. |
| Browser-supplied prices or payee | Server catalog, exact quote and configured sandbox merchant. Payment operations are session-bound. |
| Cross-session access or disclosure | HttpOnly cookie, ownership checks, origin checks, and session identifier removal from public JSON. Anonymous workspaces do not provide organization-wide limits. |
| Duplicate payment or timeout | Atomic reservations, provider request IDs, approval check and reconciliation. Manual review can be needed for ambiguous outcomes. |
| Forged webhook | Verify through PayPal, reconcile references and payment amount, deduplicate in a database transaction. Real delivery acceptance is pending. |
| Ledger tampering | Recorded inputs and SHA-256 checksums detect inconsistent edits. A database administrator can rewrite both evidence and checksum. |
| Sensitive text in an AI prompt | Use synthetic inputs only. A user can enter arbitrary text, which is sent to the configured model when research is requested. |
