# Temporary HTTPS demo with ngrok

Run BuyWise locally on port 3000, then run this in a second terminal:

For a public demo use **START-NGROK-DEMO.cmd** to build and run the optimized app. Stop any existing app on port 3000 first. This avoids sending large development bundles over the tunnel. START-BUYWISE.cmd remains the development launcher.

```sh
ngrok http http://127.0.0.1:3000
```

Once the tunnel is online, from the BuyWise project directory run:

```sh
node --env-file=.env.local scripts/configure-ngrok.mjs
```

The script checks the public health endpoint, registers or updates this app's PayPal sandbox webhook, retrieves the registration to verify all four subscribed events, and saves APP_URL and PAYPAL_WEBHOOK_ID in .env.local. It preserves other environment values and does not print credentials. It reuses a matching URL or the previously configured webhook ID and leaves unrelated listeners untouched. Restart BuyWise if Settings does not show the new configuration.

Open the HTTPS address printed by ngrok. On the free plan a first-time visitor may need to click **Visit Site** on ngrok's warning page. This is an ngrok feature, not an app login. API/webhook traffic is not subject to that HTML visitor page. See [ngrok documentation](https://ngrok.com/docs/pricing-limits/free-plan-limits).

The setup script sets ALLOW_LOCAL_DEMO=true so both localhost and the explicitly configured HTTPS origin are accepted for this local tunnel. HTTPS sessions use Secure cookies. Each hostname has separate browser cookies and therefore its own workspace. Your localhost mandate/history will not automatically appear at the ngrok address. Create a mandate on that address before checkout. Set ALLOW_LOCAL_DEMO=false for cloud deployment so production only accepts APP_URL.

Keep the computer awake, internet connected, BuyWise running and ngrok running. Closing either process or sleeping the computer makes the public app and webhook unreachable. No paid plan is needed for this temporary setup. Free account quotas still apply. Do not expose ngrok's local inspection interface publicly.

The webhook listener is `APP_URL/api/paypal/webhooks`. Registration and reachability do not prove receipt of a genuine payment event. Complete a sandbox buyer-approved purchase from the HTTPS app and confirm both its capture ID and the **PayPal webhook verified** label. Simulator events cannot establish this app's postback verification acceptance.

For cloud deployment, update APP_URL and the existing PayPal listener URL to the deployed origin, retain durable database storage and repeat the real payment verification. Never publish .env.local.
