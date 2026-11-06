# Submission acceptance checklist

## Completed in local verification

- [x] Production build and type checking.
- [x] Policy and service automated tests with mocked providers.
- [x] Browser: confirm $300 / 5 keyboards mandate.
- [x] Browser: reject $345 purchase without reserving money.
- [x] Browser: reserve $245 for 5 Hush keyboards and release on cancellation.
- [x] Browser: labeled malicious listing / unsafe proposal blocked before PayPal.
- [x] 13 HTTP checks against the running local server.
- [x] Desktop and phone layout inspection; phone has no horizontal overflow.

## Required before recording or submitting as a complete integration

- [x] Real Gemini recommendation through the running app on 5 November 2026: gemini-3.5-flash-lite, five Hush 75 Wireless keyboards, $245; policy passed.
- [x] Real PayPal sandbox order created and retrieved; merchant, reference and $245 amount matched. No buyer approval or capture requested in this test.
- [ ] One real PayPal sandbox create/approve/capture; save order/capture IDs privately.
- [ ] Genuine webhook verified; receipt shows correct amount, merchant and capture.
- [ ] Decline/cancel in PayPal; no paid-success state.
- [ ] Repeat approval callback / refresh / status check; no duplicate capture.
- [ ] Restart app; records persist.
- [ ] Fresh checkout on another machine installs and runs from README.
- [ ] Public GitHub repository includes lockfile, source, docs and MIT license; no .env.local, SQLite data or secrets.
- [ ] Public YouTube video shorter than 3 minutes shows the actual working integrations.
- [ ] Devpost description accurately separates implemented, tested and future features.
- [ ] Submission saved before 12 November 2026, 02:00 Dhaka internal target.

Do not check a real-provider item because a mocked test passed. Do not label credentials merely present as a verified connection.
