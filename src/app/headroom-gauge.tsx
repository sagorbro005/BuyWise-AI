'use client';

import { Gauge, ShieldAlert } from 'lucide-react';
import { computeHeadroomSummary } from '../core/headroom.mjs';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);

type HeadroomCategory = {
  category: string;
  label: string;
  capturedCents: number;
  reservedCents: number;
  totalCents: number;
  unitsUsed: number;
  unitLimit: number | null;
  allowed: boolean;
  sharePct: number;
};

type HeadroomSummary = {
  budgetCents: number;
  spentCents: number;
  reservedCents: number;
  availableCents: number;
  overBudgetCents: number;
  spentPct: number;
  reservedPct: number;
  availablePct: number;
  utilizationPct: number;
  health: string;
  categories: HeadroomCategory[];
};

export function HeadroomGauge({
  mandate,
  spentCents,
  reservedCents,
  intents,
}: {
  mandate: {
    version: number;
    name?: string;
    active: boolean;
    budgetCents: number;
    maxPurchaseCents: number;
    maxQuantity: number;
    categories: string[];
    categoryLimits?: Record<string, number>;
  } | null;
  spentCents: number;
  reservedCents: number;
  intents: unknown[];
}) {
  const summary = computeHeadroomSummary(mandate, spentCents, reservedCents, intents) as HeadroomSummary;

  const healthLabel =
    summary.health === 'unconfigured'
      ? 'Set mandate to track limits'
      : summary.health === 'inactive'
        ? 'Mandate revoked'
        : summary.overBudgetCents > 0
          ? `${money(summary.overBudgetCents)} above current cap`
          : summary.health === 'critical'
            ? 'Near or at limit'
            : summary.health === 'warning'
              ? 'Active utilization'
              : 'Healthy headroom';

  return (
    <section className="panel headroom-panel" aria-labelledby="headroom-heading">
      <div className="headroom-header">
        <div className="headroom-title-group">
          <span className="headroom-icon"><Gauge size={18} /></span>
          <div>
            <h2 id="headroom-heading">Spending headroom &amp; allocation</h2>
            <p>
              {mandate
                ? `${mandate.name || 'Office purchasing'} · v${mandate.version} · Cap ${money(mandate.maxPurchaseCents)}/order`
                : 'Confirm a spending mandate on the right to activate real-time budget gauges.'}
            </p>
          </div>
        </div>
        <div className="headroom-metrics">
          <span className={`headroom-status-pill ${summary.health}`}>
            {summary.overBudgetCents > 0 && <ShieldAlert size={13} />}
            {healthLabel}
          </span>
          <strong className="headroom-pct">
            {summary.utilizationPct}% <span>utilized</span>
          </strong>
        </div>
      </div>

      <div
        className="headroom-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={summary.utilizationPct}
        aria-label={`Budget utilization ${summary.utilizationPct}%`}
      >
        {summary.spentPct > 0 && (
          <div
            className="headroom-seg-captured"
            style={{ width: `${summary.spentPct}%` }}
            title={`Confirmed captured: ${money(summary.spentCents)} (${summary.spentPct}%)`}
          />
        )}
        {summary.reservedPct > 0 && (
          <div
            className="headroom-seg-reserved"
            style={{ width: `${summary.reservedPct}%` }}
            title={`In-flight reserved: ${money(summary.reservedCents)} (${summary.reservedPct}%)`}
          />
        )}
      </div>

      <div className="headroom-legend">
        <div className="legend-item">
          <span className="legend-dot captured" />
          <span>Confirmed captured:</span>
          <strong>{money(summary.spentCents)}</strong>
          <small>({summary.spentPct}%)</small>
        </div>
        <div className="legend-item">
          <span className="legend-dot reserved" />
          <span>Reserved hold:</span>
          <strong>{money(summary.reservedCents)}</strong>
          <small>({summary.reservedPct}%)</small>
        </div>
        <div className="legend-item">
          <span className="legend-dot available" />
          <span>Available headroom:</span>
          <strong>{money(summary.availableCents)}</strong>
          <small>of {money(summary.budgetCents)}</small>
        </div>
      </div>

      {summary.categories.length > 0 && (
        <div className="headroom-categories">
          {summary.categories.map((cat) => (
            <div className="headroom-cat-pill" key={cat.category}>
              <div className="headroom-cat-top">
                <span className="headroom-cat-name">
                  {cat.label}
                  {!cat.allowed && <span className="headroom-cat-legacy"> (prior)</span>}
                </span>
                <strong>{money(cat.totalCents)}</strong>
              </div>
              <div className="headroom-cat-bar">
                <div
                  className="headroom-cat-fill"
                  style={{ width: `${cat.sharePct}%` }}
                />
              </div>
              <div className="headroom-cat-foot">
                <span>
                  {cat.unitsUsed} {cat.unitsUsed === 1 ? 'unit' : 'units'}
                  {cat.unitLimit !== null ? ` · max ${cat.unitLimit}/order` : ''}
                </span>
                <span>{cat.sharePct}% of budget</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
