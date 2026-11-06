# Rules review and zero-cost prize strategy

Reviewed 6 November 2026 against the entrant's pasted rules and [official rules](https://paypalaihackathon.devpost.com/rules). This is an engineering readiness review. The organizer decides eligibility and awards. Nothing in this document promises a prize.

## Decision

Build the strongest working BuyWise demonstration with PayPal, Gemini and AG Grid Community. The primary sponsor target is AG Grid. A larger count of sponsor logos is not a judging criterion. Only claim tools actually used and demonstrate their contribution.

The supplied prize table lists sponsor awards for AG Grid, APIMatic, Bryntum, Channel3 and Render. Astropods, Elastic, KERNEL, Postman and Zapier are available resources but have no separate prize in that table. A submission can win at most one sponsor prize alongside either one grand prize or one honorable mention. Check the final submission form for changes before submitting.

## Sponsor choices

| Tool | Actual use or decision | Cost and evidence |
| --- | --- | --- |
| AG Grid | Implemented. Payment ledger and security event grid, sorting, filters, dark/light theme, CSV exports with formula protection and decision hashes. Primary sponsor target. | Community package, no enterprise import or license key. Browser acceptance covers filtered audit export. [Sponsor page](https://paypalaihackathon.devpost.com/details/aggrid) emphasizes polish and advanced dashboards. Community usage meets the prize table's tool-use criterion, but does not establish award competitiveness or replace organizer review. We do not claim AG Studio or its agent framework. |
| APIMatic | Not integrated or claimed. Reconsider only if its Context Plugin can actually improve and verify the existing PayPal adapter. | [Sponsor page](https://paypalaihackathon.devpost.com/details/apimatic) says enabled PayPal context needs no APIMatic credentials. Resource PDF was not readable through the web tool. Visiting its page does not count as using its plugin. No trial activated. |
| Channel3 | Suitable optional discovery extension, not integrated or claimed. Requires account and key, contract tests, live results, source/time labels and a discovery-only UI. Third-party listings must never become payable through our sandbox merchant. | [Sponsor offer](https://paypalaihackathon.devpost.com/details/channel3) advertises 20,000 credits with PAYPAL-HACKATHON-2026 and no card. A reference or unused key does not qualify. Keep disabled until a genuine API call and UI are verified. |
| Bryntum | Deferred. Scheduling is outside the purchasing demo and would duplicate dashboard work. | [Sponsor page](https://paypalaihackathon.devpost.com/details/bryntum) offers a 45-day trial. No perpetual free license established. Redistribution and judging-period coverage need review before adoption. |
| Render | Not deployed or claimed. Current SQLite ledger needs persistent storage. | [Free hosting documentation](https://render.com/docs/free) states that local files disappear on restarts and free databases expire after 30 days. A Render deployment requires a tested external durable store and verified no-charge account limits. Credits prizes are not cash. |

## Rule-to-evidence matrix

| Requirement from supplied rules | Evidence / next gate |
| --- | --- |
| PayPal and AI central | Gemini structured recommendation and actual PayPal sandbox create/retrieve verified. Buyer approval, capture and signed webhook on the same order still open. |
| Real, consistently runnable web application | Next.js browser app with server API and SQLite. `npm ci`, `npm run verify:release`, then documented local run. Automated suite exercises an isolated production build, not just a mockup. |
| Free judge access | Local setup is permitted by the supplied rules. README explains account/key requirements. A fresh-machine setup and an agreed secure way for judges to access required sandbox credentials remain open. Never publish provider secrets. |
| Public repository and open-source license | MIT LICENSE and source present locally. Public repository URL, anonymous clone and license recognition still open. Do not upload `.env.local`, database, cookies or captured logs containing credentials. |
| Accurate English description | README and demo script in English. Describe fictional inventory and pending live checks honestly. Update final description only after acceptance evidence. |
| Functioning video under 3 minutes on public YouTube | Script targets 2m40s. Record actual UI and approval/capture, then check visibility, runtime and link signed out. No video exists yet. |
| New/significantly updated during submission period | Preserve dated source history and implementation notes. Entrant confirms start date and any pre-existing work. No invented commit history. |
| Originality, ownership and third-party permission | Original app SVGs, package notices and MIT app license. Entrant reviews rights, AI assistance disclosure, trademarks and any recorded assets. No unlicensed music. |
| Eligibility and conflict restrictions | Entrant must confirm age of majority, residency, role and applicable exclusions. Student status alone is not proof of eligibility. No sensitive identity documents belong in the repository. |
| Available until judging ends | Official judging ends 15 Dec 2026 at 08:00 Pacific, or 22:00 Dhaka. Keep code, instructions, video and agreed test access available through that time. A short trial or temporary tunnel alone is insufficient. |
| Submission on time | Deadline 13 Nov 2026 at 02:00 Dhaka. Target final submission at least one day earlier. Save submission confirmation. A draft does not count as submitted. |

## Release procedure

1. Run `npm ci` from a clean copy using supported Node. Keep all secrets outside source control.
2. Run `npm run verify:release`. This runs lint, unit/service tests, a production build, HTTP boundary checks and browser acceptance in a disposable database with provider credentials disabled. It writes `artifacts/release-verification.json`. Existing lint warnings are visible in output. A passing report establishes this limited automated scope only.
3. Complete real Gemini request, malicious fixture rejection, safe review, PayPal buyer approval and capture. Receive a genuine signed webhook for that same order. Record order/capture/event references and redacted screenshots in a local evidence log. Retry/replay without double spending and restart to confirm persistence.
4. Have the entrant run the clean setup independently. Check mobile layout, light/dark mode, missing-key errors, actual AI quota failure, canceled approval and clear recovery instructions.
5. Review dependencies and licenses, then publish the exact tested source with MIT LICENSE. Check public clone and setup signed out. Re-run acceptance if source changes.
6. Record truthful screen footage, export under 180 seconds, publish on YouTube and verify signed-out access. Do not show dashboards with secrets. Demonstrate AG Grid filtering and the decision evidence export briefly.
7. Fill every row in SUBMISSION_CHECKLIST.md with evidence. Check all URLs and judge access, then submit Devpost and save confirmation. Preserve the tested version through judging.

## Judging focus

Technology: verified PayPal lifecycle, independent policy checks and idempotency. Design: coherent request-to-review flow with clear failures. Impact: small teams need bounded equipment purchasing, demonstrated with a concrete five-keyboard example. Innovation: versioned user permission and inspectable decision evidence. Presentation: show the unsafe proposal blocked, then a successful buyer-approved purchase. These are five equally weighted criteria in the supplied rules.

## Hard cost boundary

No paid plan, card entry, enterprise package, automatic paid fallback or billable cloud deployment is authorized by this plan. No new service was activated in this review. Existing provider account quotas and billing settings still require owner verification. If a free quota stops, show the error and retain manual catalog browsing. Do not disguise a fixture as live AI or payments.
