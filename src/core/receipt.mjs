function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
}

function toUtcIso(timestamp) {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function formatUtcDisplay(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const d = new Date(timestamp);
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }).format(d);
  return `${date} · ${time} UTC`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseWebhookDetail(detail) {
  if (typeof detail !== 'string') return { eventType: null, eventId: null };
  const parts = detail.split('·').map(part => part.trim());
  if (parts.length >= 2 && parts[0].startsWith('PAYMENT.CAPTURE.')) {
    return { eventType: parts[0], eventId: parts.slice(1).join(' · ') };
  }
  return { eventType: null, eventId: null };
}

/**
 * Build a verified procurement receipt exclusively from confirmed capture,
 * webhook, mandate, and SHA-256 decision evidence records.
 */
export function buildProcurementReceipt(intent, events = []) {
  if (intent?.status !== 'captured' || !intent.captureId) {
    throw new Error('A verified procurement receipt is only available after PayPal capture completes.');
  }

  const related = Array.isArray(events)
    ? events.filter(e => e.intentId === intent.id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    : [];

  const captureEvent = related.find(e => e.kind === 'payment' && e.title === 'Sandbox payment captured');
  const webhookEvent = related.find(e => e.kind === 'verified' && e.title === 'PayPal webhook verified' && String(e.detail || '').startsWith('PAYMENT.CAPTURE.COMPLETED'));
  const latestPolicyEvent = related.find(e => e.kind === 'policy' && (e.evidenceSha256 || e.evidence));
  const parsedWebhook = parseWebhookDetail(webhookEvent?.detail);

  const items = Array.isArray(intent.lines) && intent.lines.length
    ? intent.lines.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        category: product.category ?? null,
        quantity,
        unitPriceCents: product.unitPriceCents,
        shippingCents: product.shippingCents ?? 0,
        taxCents: product.taxCents ?? 0,
        lineTotalCents: product.unitPriceCents * quantity + (product.shippingCents ?? 0) + (product.taxCents ?? 0),
      }))
    : [{
        productId: intent.productId,
        name: intent.productName,
        category: intent.quote?.category ?? null,
        quantity: intent.quantity,
        unitPriceCents: intent.quote?.unitPriceCents ?? Math.round(intent.totalCents / Math.max(1, intent.quantity)),
        shippingCents: intent.quote?.shippingCents ?? 0,
        taxCents: intent.quote?.taxCents ?? 0,
        lineTotalCents: intent.totalCents,
      }];

  const webhookVerified = Boolean(intent.webhookVerified);
  const webhookEventId = intent.webhookEventId ?? (webhookVerified ? parsedWebhook.eventId : null);
  const webhookEventType = intent.webhookEventType ?? (webhookVerified ? parsedWebhook.eventType || 'PAYMENT.CAPTURE.COMPLETED' : null);
  const webhookRawTime = webhookVerified ? (intent.webhookVerifiedAt ?? webhookEvent?.createdAt ?? null) : null;
  const capturedRawTime = intent.capturedAt ?? captureEvent?.createdAt ?? intent.createdAt;
  const webhookVerifiedAt = toUtcIso(webhookRawTime);
  const webhookVerifiedAtDisplay = formatUtcDisplay(webhookRawTime);
  const capturedAt = toUtcIso(capturedRawTime);
  const capturedAtDisplay = formatUtcDisplay(capturedRawTime);

  return {
    schemaVersion: 1,
    receiptId: intent.id,
    environment: 'PayPal Sandbox',
    status: webhookVerified ? 'CAPTURE_AND_WEBHOOK_VERIFIED' : 'CAPTURE_CONFIRMED_WEBHOOK_PENDING',
    statusLabel: webhookVerified
      ? 'Capture confirmed · PayPal webhook verified'
      : 'Capture confirmed · Webhook confirmation pending',
    merchantId: intent.lines?.[0]?.product?.merchantId ?? intent.quote?.merchantId ?? 'buywise-sandbox',
    currency: intent.quote?.currency ?? 'USD',
    totalCents: intent.totalCents,
    totalFormatted: formatUsd(intent.totalCents),
    paypal: {
      orderId: intent.orderId,
      captureId: intent.captureId,
      capturedAt,
      capturedAtDisplay,
    },
    webhook: {
      verified: webhookVerified,
      eventId: webhookEventId,
      eventType: webhookEventType,
      verifiedAt: webhookVerifiedAt,
      verifiedAtDisplay: webhookVerifiedAtDisplay,
    },
    mandate: {
      version: intent.mandateVersion,
      versionLabel: `v${intent.mandateVersion}`,
      name: intent.mandateName ?? latestPolicyEvent?.evidence?.mandate?.name ?? 'Office purchasing',
      mandateSha256: intent.mandateSha256 ?? latestPolicyEvent?.evidence?.mandateSha256 ?? null,
    },
    decisionEvidence: {
      sha256: latestPolicyEvent?.evidenceSha256 ?? intent.decisionEvidenceSha256 ?? null,
      integrityVerified: latestPolicyEvent?.evidenceVerified ?? (intent.decisionEvidenceSha256 ? true : null),
      stage: latestPolicyEvent?.title ?? 'Purchase cleared by AgentGuard',
    },
    items,
  };
}

/** Render a standalone, XSS-safe printable HTML/PDF procurement receipt with the BuyWise logo. */
export function renderPrintableReceiptHtml(receipt) {
  const rows = receipt.items.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><br><span class="mono muted">${escapeHtml(item.productId)}${item.category ? ` · ${escapeHtml(item.category)}` : ''}</span></td>
      <td class="num">${escapeHtml(item.quantity)}</td>
      <td class="num">${escapeHtml(formatUsd(item.unitPriceCents))}</td>
      <td class="num">${escapeHtml(formatUsd((item.shippingCents ?? 0) + (item.taxCents ?? 0)))}</td>
      <td class="num"><strong>${escapeHtml(formatUsd(item.lineTotalCents))}</strong></td>
    </tr>`).join('');

  const webhookRow = receipt.webhook.verified
    ? `${escapeHtml(receipt.webhook.eventId || 'Verified')} <span class="muted">(${escapeHtml(receipt.webhook.eventType || 'PAYMENT.CAPTURE.COMPLETED')})</span>`
    : 'Pending signed webhook delivery';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BuyWise Verified Receipt · ${escapeHtml(receipt.paypal.captureId)}</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 24px; background: #f4f6fb; color: #202543; font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; font-size: 13px; line-height: 1.5; }
    .sheet { max-width: 780px; margin: 0 auto; background: #ffffff; border: 1px solid #dce1ee; border-radius: 12px; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #dce1ee; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { display: inline-flex; align-items: center; font-family: 'Manrope', 'Segoe UI', Arial, sans-serif; font-size: 28px; font-weight: 800; letter-spacing: -1.4px; color: #202543; line-height: 1; }
    .brand-symbol { width: 32px; height: 34px; position: relative; font-size: 38px; line-height: 28px; font-weight: 800; margin-right: 9px; color: #5143ba; display: inline-block; }
    .brand-symbol > span { position: absolute; font-size: 22px; right: -2px; top: -6px; }
    .brand-dot { color: #5143ba; }
    .badge { display: inline-block; padding: 5px 11px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .3px; background: ${receipt.webhook.verified ? '#e0f5ef' : '#eeebff'}; color: ${receipt.webhook.verified ? '#11675f' : '#5143ba'}; }
    .meta-right { text-align: right; }
    .meta-right h1 { margin: 8px 0 2px; font-size: 18px; letter-spacing: -0.4px; }
    .muted { color: #57637b; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; word-break: break-all; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
    .box { border: 1px solid #dce1ee; background: #fafbff; border-radius: 8px; padding: 14px 16px; }
    .box h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: #5143ba; }
    .kv { display: grid; gap: 6px; }
    .kv div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .kv span:first-child { color: #57637b; white-space: nowrap; flex-shrink: 0; }
    .kv strong, .kv code { text-align: right; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #57637b; border-bottom: 1px solid #dce1ee; padding: 10px 8px; }
    td { padding: 12px 8px; border-bottom: 1px solid #eef1f7; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .total-row { display: flex; justify-content: flex-end; align-items: baseline; gap: 16px; font-size: 16px; padding-top: 8px; }
    .total-row strong { font-size: 22px; color: #202543; }
    .hash-box { border: 1px solid #dce1ee; border-radius: 8px; padding: 12px 14px; margin-top: 20px; background: #f4f5fb; }
    .hash-box div { margin-bottom: 4px; }
    .footer { margin-top: 24px; padding-top: 14px; border-top: 1px solid #dce1ee; font-size: 11px; color: #57637b; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    @media print { body { background: #ffffff; padding: 0; } .sheet { border: 0; padding: 0; } }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="header">
      <div>
        <div class="brand" aria-label="BuyWise"><span class="brand-symbol">b<span>&#8599;</span></span>buywise<span class="brand-dot">.</span></div>
        <p class="muted" style="margin:8px 0 0;">Verified Procurement Receipt</p>
      </div>
      <div class="meta-right">
        <span class="badge">${escapeHtml(receipt.statusLabel)}</span>
        <h1>${escapeHtml(receipt.totalFormatted)} ${escapeHtml(receipt.currency)}</h1>
        <span class="mono muted">Receipt ID: ${escapeHtml(receipt.receiptId)}</span>
      </div>
    </header>

    <section class="grid">
      <div class="box">
        <h2>PayPal &amp; Webhook Evidence</h2>
        <div class="kv">
          <div><span>PayPal Order ID</span><code class="mono">${escapeHtml(receipt.paypal.orderId)}</code></div>
          <div><span>PayPal Capture ID</span><code class="mono">${escapeHtml(receipt.paypal.captureId)}</code></div>
          <div><span>Captured (UTC)</span><strong>${escapeHtml(receipt.paypal.capturedAtDisplay || 'Confirmed')}</strong></div>
          <div><span>Webhook Event</span><code class="mono">${webhookRow}</code></div>
          <div><span>Webhook Verified (UTC)</span><strong>${escapeHtml(receipt.webhook.verifiedAtDisplay || 'Pending')}</strong></div>
        </div>
      </div>
      <div class="box">
        <h2>Mandate &amp; Authorization</h2>
        <div class="kv">
          <div><span>Mandate Version</span><strong>${escapeHtml(receipt.mandate.versionLabel)}</strong></div>
          <div><span>Mandate Name</span><strong>${escapeHtml(receipt.mandate.name)}</strong></div>
          <div><span>Approved Merchant</span><code class="mono">${escapeHtml(receipt.merchantId)}</code></div>
          <div><span>Policy Stage</span><strong>${escapeHtml(receipt.decisionEvidence.stage)}</strong></div>
          <div><span>Environment</span><strong>PayPal Sandbox</strong></div>
        </div>
      </div>
    </section>

    <section>
      <table>
        <thead>
          <tr>
            <th>Item &amp; SKU</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Ship / Tax</th>
            <th class="num">Line Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total-row">
        <span class="muted">Confirmed Total Paid (${escapeHtml(receipt.currency)})</span>
        <strong>${escapeHtml(receipt.totalFormatted)}</strong>
      </div>
    </section>

    <section class="hash-box">
      <div><strong>Decision Evidence SHA-256</strong> ${receipt.decisionEvidence.integrityVerified === true ? '<span class="muted">(Verified)</span>' : ''}</div>
      <div class="mono">${escapeHtml(receipt.decisionEvidence.sha256 || 'Unavailable')}</div>
      ${receipt.mandate.mandateSha256 ? `<div style="margin-top:8px;"><strong>Mandate Policy SHA-256</strong></div><div class="mono">${escapeHtml(receipt.mandate.mandateSha256)}</div>` : ''}
    </section>

    <footer class="footer">
      <span>This is system generated document and doesn&apos;t require any signature</span>
      <span>${escapeHtml(receipt.environment)}</span>
    </footer>
  </main>
</body>
</html>`;
}
