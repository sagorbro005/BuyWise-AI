'use client';

import { Check, Download, FileCode2, Printer, ShieldCheck, X } from 'lucide-react';
import { buildProcurementReceipt, renderPrintableReceiptHtml } from '@/core/receipt.mjs';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ReceiptItem = {
  productId: string;
  name: string;
  category: string | null;
  quantity: number;
  unitPriceCents: number;
  shippingCents: number;
  taxCents: number;
  lineTotalCents: number;
};

export type ProcurementReceipt = {
  schemaVersion: number;
  receiptId: string;
  environment: string;
  status: string;
  statusLabel: string;
  merchantId: string;
  currency: string;
  totalCents: number;
  totalFormatted: string;
  paypal: { orderId: string | null; captureId: string | null; capturedAt: string | null; capturedAtDisplay: string | null };
  webhook: { verified: boolean; eventId: string | null; eventType: string | null; verifiedAt: string | null; verifiedAtDisplay: string | null };
  mandate: { version: number; versionLabel: string; name: string; mandateSha256: string | null };
  decisionEvidence: { sha256: string | null; integrityVerified: boolean | null; stage: string };
  items: ReceiptItem[];
};

export type ReceiptIntent = Parameters<typeof buildProcurementReceipt>[0];
export type ReceiptEvent = NonNullable<Parameters<typeof buildProcurementReceipt>[1]>[number];

export function ReceiptModal({
  intent,
  events,
  onClose,
}: {
  intent: ReceiptIntent;
  events: ReceiptEvent[];
  onClose: () => void;
}) {
  const receipt = buildProcurementReceipt(intent, events) as ProcurementReceipt;
  const slug = (receipt.paypal.captureId || receipt.receiptId).replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <div className="receipt-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
      <div className="receipt-modal-shell">
        <div className="receipt-modal-toolbar">
          <div className="receipt-modal-actions">
            <button type="button" className="button primary" onClick={() => window.print()}>
              <Printer size={15} /> Print / Save PDF
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => downloadFile(`buywise-receipt-${slug}.html`, renderPrintableReceiptHtml(receipt), 'text/html;charset=utf-8')}
            >
              <Download size={15} /> Download HTML
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => downloadFile(`buywise-receipt-${slug}.json`, JSON.stringify(receipt, null, 2), 'application/json;charset=utf-8')}
            >
              <FileCode2 size={15} /> Download JSON
            </button>
          </div>
          <button type="button" className="icon-button receipt-close" aria-label="Close receipt" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <article className="receipt-sheet">
          <header className="receipt-sheet-header">
            <div>
              <div className="brand receipt-brand">
                <span className="brand-symbol" aria-hidden="true">
                  b<span>↗</span>
                </span>
                buywise<span className="brand-dot">.</span>
              </div>
              <p className="receipt-subtitle">Verified Procurement Receipt</p>
            </div>
            <div className="receipt-header-meta">
              <span className={`receipt-status-pill ${receipt.webhook.verified ? 'verified' : ''}`}>
                {receipt.webhook.verified ? <ShieldCheck size={13} /> : <Check size={13} />}
                {receipt.statusLabel}
              </span>
              <h2 id="receipt-modal-title">{receipt.totalFormatted} {receipt.currency}</h2>
              <code className="receipt-mono">Receipt ID: {receipt.receiptId}</code>
            </div>
          </header>

          <div className="receipt-meta-grid">
            <section className="receipt-meta-box">
              <h3>PayPal &amp; Webhook Evidence</h3>
              <dl>
                <div><dt>PayPal Order ID</dt><dd><code>{receipt.paypal.orderId}</code></dd></div>
                <div><dt>PayPal Capture ID</dt><dd><code>{receipt.paypal.captureId}</code></dd></div>
                <div><dt>Captured (UTC)</dt><dd>{receipt.paypal.capturedAtDisplay || 'Confirmed'}</dd></div>
                <div>
                  <dt>Webhook Event ID</dt>
                  <dd><code>{receipt.webhook.verified ? receipt.webhook.eventId || 'Verified' : 'Pending webhook'}</code></dd>
                </div>
                <div><dt>Webhook Verified (UTC)</dt><dd>{receipt.webhook.verifiedAtDisplay || 'Pending'}</dd></div>
              </dl>
            </section>

            <section className="receipt-meta-box">
              <h3>Mandate &amp; Authorization</h3>
              <dl>
                <div><dt>Mandate Version</dt><dd><strong>{receipt.mandate.versionLabel}</strong></dd></div>
                <div><dt>Mandate Name</dt><dd>{receipt.mandate.name}</dd></div>
                <div><dt>Approved Merchant</dt><dd><code>{receipt.merchantId}</code></dd></div>
                <div><dt>Policy Stage</dt><dd>{receipt.decisionEvidence.stage}</dd></div>
                <div><dt>Environment</dt><dd>PayPal Sandbox</dd></div>
              </dl>
            </section>
          </div>

          <table className="receipt-items-table">
            <thead>
              <tr>
                <th>Item &amp; SKU</th>
                <th className="num">Qty</th>
                <th className="num">Unit</th>
                <th className="num">Ship / Tax</th>
                <th className="num">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map(item => (
                <tr key={item.productId}>
                  <td>
                    <strong>{item.name}</strong>
                    <div className="receipt-mono">{item.productId}{item.category ? ` · ${item.category}` : ''}</div>
                  </td>
                  <td className="num">{item.quantity}</td>
                  <td className="num">{money(item.unitPriceCents)}</td>
                  <td className="num">{money(item.shippingCents + item.taxCents)}</td>
                  <td className="num"><strong>{money(item.lineTotalCents)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="receipt-total-bar">
            <span>Confirmed Total Paid ({receipt.currency})</span>
            <strong>{receipt.totalFormatted}</strong>
          </div>

          <section className="receipt-hash-box">
            <div>
              <strong>SHA-256 Decision Evidence</strong>
              {receipt.decisionEvidence.integrityVerified === true && <span> · Hash verified</span>}
            </div>
            <code>{receipt.decisionEvidence.sha256 || 'Unavailable'}</code>
            {receipt.mandate.mandateSha256 && (
              <>
                <div className="receipt-hash-secondary"><strong>Mandate Policy SHA-256</strong></div>
                <code>{receipt.mandate.mandateSha256}</code>
              </>
            )}
          </section>

          <footer className="receipt-sheet-footer">
            <span>This is system generated document and doesn&apos;t require any signature</span>
            <span>{receipt.environment}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}
