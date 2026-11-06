# BuyWise demo — target 2:40

Prerequisite: complete the real-provider acceptance checks. Use sandbox credentials only, hide developer dashboards and environment files, and do not show keys. Use original screen capture and narration, with no unlicensed music.

| Time | Screen/action | Suggested narration |
| --- | --- | --- |
| 0:00–0:15 | Workspace, $300 budget | “An AI can find a good keyboard. But should it have permission to spend your team's money? BuyWise puts an independent boundary between recommendations and payments.” |
| 0:15–0:35 | Confirm 5 keyboards, $300, approved seller, required approval | “I set a mandate: five keyboards, at most $300, from an approved seller. These are rules enforced by the server.” |
| 0:35–0:55 | Real Gemini recommendation | “The agent compares our sandbox catalog and explains its recommendation. It proposes an item and quantity. It cannot set the payment amount or change these rules.” |
| 0:55–1:20 | AgentGuard attack test | “Here is a clearly labeled adversarial test. A listing asks for fifty keyboards from another seller and tries to bypass approval. Even with an unsafe proposal, the independent policy engine blocks it. No PayPal order is created.” |
| 1:20–2:00 | Return to workspace, review Hush, sandbox buyer approval | “The safe alternative is five keyboards for $245. BuyWise reserves the budget, creates a real sandbox order, and requires my approval in PayPal before capture.” |
| 2:00–2:25 | Receipt and activity, verified webhook | “The capture and verified webhook are tied to the exact order, amount and merchant. Duplicate requests do not create another purchase. The audit trail shows what happened and why.” |
| 2:25–2:40 | Workspace / repository | “BuyWise demonstrates bounded AI purchasing: useful recommendations, explicit permissions, and human control. It is open source, runs locally, and uses PayPal sandbox. This prototype does not fulfill physical goods.” |

If real approval takes longer, trim introduction and comparison. Do not speed-edit in a way that suggests unimplemented automation. If a webhook is delayed, show capture confirmed and later verified truthfully; do not fabricate a verification label.

One-sentence pitch: **BuyWise lets an AI recommend purchases while an independent policy engine controls what can be paid through PayPal.**

Submission sections: problem (small-team purchasing), solution (mandate + recommendation + checks + approval), actual integrations, engineering challenges (idempotency, untrusted input, webhook reconciliation), tested limits, next steps. Do not claim “injection-proof” or guaranteed protection from every attack.
