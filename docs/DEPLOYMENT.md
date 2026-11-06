# Run and publish without buying services

The hackathon permits a functional local build with complete setup instructions. That is the baseline distribution. No paid hosting is required.

## Local demonstration

1. Run `npm ci`, configure `.env.local`, then `npm run build` and `npm start`.
2. Use an HTTPS tunnel for real webhook delivery if no permanent host is configured. Select a reputable tunnel whose current free access works for your account. Never expose environment files or database directories.
3. Set `APP_URL` to that exact HTTPS origin and restart. Register the full webhook URL with PayPal. Open the HTTPS address for the demo; the origin guard intentionally rejects unrelated origins.
4. Keep the server and tunnel running during the recording. A temporary tunnel is not a reliable judge-accessible hosted deployment.

## Hosting requirements

This build requires Node 22.13+, a persistent writable SQLite database and a single app instance. Use `npm ci && npm run build` for build and `npm start` to run. Health endpoint: `/api/health`. Provide environment variables through the host's secret settings. Set `DATABASE_PATH` to persistent storage and `APP_URL` to the public HTTPS origin.

**Do not deploy the payment ledger on ephemeral storage.** Render's free service filesystem does not provide a durable SQLite store, and its free PostgreSQL instance expires after 30 days. A free database created in early November would expire before judging ends in December. This implementation deliberately does not include a misleading one-click free deployment that loses payment state.

Cloudflare Sites/Workers cannot run this Node SQLite implementation unchanged; a D1/storage adapter and the host's authentication/webhook-access setup would be needed. That is separate work, not a claimed completed deployment. Keep the currently tested Node architecture for the hackathon unless a persistent free hosting option is verified.

## Public repository

Create a free GitHub account and an empty repository named `buywise-ai`. Before pushing:

- Include `package-lock.json`, `LICENSE`, `README.md`, `src`, `tests`, `scripts`, `docs` and configuration files.
- Exclude `.env.local`, `data`, `node_modules`, `.next`, build reports and screenshots containing credentials.
- Run tests and build again if source changes.
- Verify license detection and clone/run instructions in a fresh directory.
- Keep the real-provider limitations in the README until actual tests pass.

Publishing needs an authenticated GitHub account. Account sign-in and verification belong to the user. No public repository has been created by this project yet.
