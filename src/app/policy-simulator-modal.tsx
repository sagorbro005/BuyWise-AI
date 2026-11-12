'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCheck, ShieldAlert, ShieldCheck, ShieldX, SlidersHorizontal, TrendingDown, X } from 'lucide-react';
import { computeSpendForecast } from '@/core/simulator.mjs';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);

const readable = (code: string) => code.toLowerCase().replaceAll('_', ' ');

export type CatalogSimRow = {
  productId: string;
  name: string;
  category: string;
  unitPriceCents: number;
  allowed: boolean;
  reasons: string[];
};

export type HistoricalSimRow = {
  id: string;
  productName: string;
  quantity: number;
  totalCents: number;
  originalStatus: string;
  wouldPass: boolean;
  reasons: string[];
};

export type SimulationReport = {
  dryRun: boolean;
  candidate: {
    name: string;
    budgetCents: number;
    maxPurchaseCents: number;
    maxQuantity: number;
    durationHours: number;
    categories: string[];
    merchantIds: string[];
  };
  catalogSummary: {
    totalSkus: number;
    allowedSkus: number;
    blockedSkus: number;
    baselineAllowedSkus: number;
    baselineSurfaceCents: number;
    candidateSurfaceCents: number;
    riskReductionPct: number;
  };
  historicalSummary: {
    totalEvaluated: number;
    passedCount: number;
    blockedCount: number;
    blockedSavingsCents: number;
    items: HistoricalSimRow[];
  };
  catalogItems: CatalogSimRow[];
  initialForecast: {
    orderCostCents: number;
    startingHeadroomCents: number;
    endingRemainingCents: number;
    affordableOrders: number;
    exhaustionOrder: number | null;
    steps: Array<{
      orderNumber: number;
      orderCostCents: number;
      allowed: boolean;
      reasons: string[];
      remainingAfterCents: number;
      utilizationPct: number;
    }>;
  };
};

export function PolicySimulatorModal({
  report,
  committedCents,
  confirmDisabled,
  busy,
  onApply,
  onClose,
}: {
  report: SimulationReport;
  committedCents: number;
  confirmDisabled: boolean;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const firstEligible = report.catalogItems.find(item => item.allowed) ?? report.catalogItems[0];
  const [simQty, setSimQty] = useState(Math.min(5, report.candidate.maxQuantity));
  const [simPriceDollars, setSimPriceDollars] = useState(Math.round((firstEligible?.unitPriceCents ?? 4900) / 100));
  const [simPeriods, setSimPeriods] = useState(6);
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'allowed' | 'blocked'>('all');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const forecast = computeSpendForecast({
    budgetCents: report.candidate.budgetCents,
    maxPurchaseCents: report.candidate.maxPurchaseCents,
    maxQuantity: report.candidate.maxQuantity,
    alreadyCommittedCents: committedCents,
    unitPriceCents: simPriceDollars * 100,
    quantity: simQty,
    periods: simPeriods,
  }) as SimulationReport['initialForecast'];

  const { catalogSummary, historicalSummary, candidate } = report;
  const visibleCatalog = report.catalogItems.filter(item =>
    catalogFilter === 'allowed' ? item.allowed : catalogFilter === 'blocked' ? !item.allowed : true
  );

  const riskLabel =
    catalogSummary.riskReductionPct > 0
      ? `Projected risk exposure reduced by ${catalogSummary.riskReductionPct}%`
      : catalogSummary.riskReductionPct < 0
        ? `Projected exposure widened by ${Math.abs(catalogSummary.riskReductionPct)}%`
        : 'Risk exposure unchanged from current rules';

  return (
    <div className="receipt-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="simulator-modal-title">
      <div className="receipt-modal-shell simulator-shell">
        <div className="panel simulator-card">
          <header className="simulator-header">
            <div className="simulator-title-row">
              <span className="rule-icon"><SlidersHorizontal size={20} /></span>
              <div>
                <div className="simulator-kicker">
                  <span>WHAT-IF POLICY SIMULATOR</span>
                </div>
                <h2 id="simulator-modal-title">{candidate.name} · Draft Impact &amp; Spend Forecast</h2>
              </div>
            </div>
            <button type="button" className="icon-button receipt-close" aria-label="Close simulator" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          <div className="simulator-kpi-grid">
            <div className="simulator-kpi">
              <span className="kpi-label">Past Purchases Impact</span>
              <strong>
                {historicalSummary.blockedCount > 0
                  ? `${historicalSummary.blockedCount} would be blocked`
                  : historicalSummary.totalEvaluated > 0
                    ? `All ${historicalSummary.totalEvaluated} pass`
                    : '0 past orders yet'}
              </strong>
              <small>
                {historicalSummary.blockedCount > 0
                  ? `Saving ${money(historicalSummary.blockedSavingsCents)} under draft rules`
                  : `Simulated live across ${catalogSummary.totalSkus} catalog items`}
              </small>
            </div>

            <div className="simulator-kpi">
              <span className="kpi-label">Catalog Risk Exposure</span>
              <strong className={catalogSummary.riskReductionPct > 0 ? 'kpi-teal' : ''}>
                <TrendingDown size={15} /> {catalogSummary.allowedSkus} / {catalogSummary.totalSkus} SKUs allowed
              </strong>
              <small>{riskLabel}</small>
            </div>

            <div className="simulator-kpi">
              <span className="kpi-label">Simulated Policy Caps</span>
              <strong>{money(candidate.budgetCents)} limit</strong>
              <small>
                {money(candidate.maxPurchaseCents)}/order cap · Max {candidate.maxQuantity} units · {candidate.durationHours}h
              </small>
            </div>
          </div>

          <section className="simulator-forecaster">
            <div className="section-heading">
              <div>
                <h3>Interactive Spend Forecaster</h3>
                <p>Slide quantity and item price to see exactly when your mandate budget runs out.</p>
              </div>
              <div className="cadence-pills">
                {[3, 6, 12].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`button compact ${simPeriods === n ? 'primary' : 'secondary'}`}
                    onClick={() => setSimPeriods(n)}
                  >
                    {n} cycles
                  </button>
                ))}
              </div>
            </div>

            <div className="forecaster-controls">
              <label className="slider-field">
                <span>
                  Units per order: <strong>{simQty}</strong>
                </span>
                <input
                  type="range"
                  aria-label="Simulated units per order"
                  min={1}
                  max={Math.max(12, candidate.maxQuantity + 2)}
                  value={simQty}
                  onChange={e => setSimQty(Number(e.target.value))}
                />
              </label>

              <label className="slider-field">
                <span>
                  Unit price: <strong>${simPriceDollars}</strong> ({money(forecast.orderCostCents)}/order)
                </span>
                <input
                  type="range"
                  aria-label="Simulated unit price"
                  min={10}
                  max={250}
                  step={1}
                  value={simPriceDollars}
                  onChange={e => setSimPriceDollars(Number(e.target.value))}
                />
              </label>
            </div>

            <div className={`forecast-verdict ${forecast.exhaustionOrder === 1 ? 'critical' : forecast.exhaustionOrder ? 'warn' : 'ok'}`}>
              {forecast.exhaustionOrder === null ? <CheckCheck size={17} /> : <ShieldAlert size={17} />}
              <span>
                {forecast.exhaustionOrder === null
                  ? `Budget covers all ${simPeriods} orders (${money(forecast.orderCostCents)} each) with ${money(forecast.endingRemainingCents)} remaining.`
                  : forecast.affordableOrders === 0
                    ? `Blocked on Order #1: ${simQty} × $${simPriceDollars} (${money(forecast.orderCostCents)}) exceeds your simulated limits or remaining headroom.`
                    : `Supports ${forecast.affordableOrders} full order${forecast.affordableOrders === 1 ? '' : 's'} and runs out on Order #${forecast.exhaustionOrder} (${money(forecast.endingRemainingCents)} left).`}
              </span>
            </div>

            <div className="forecast-steps">
              {forecast.steps.map(step => {
                const remainPct = candidate.budgetCents > 0
                  ? Math.max(0, Math.round((step.remainingAfterCents / candidate.budgetCents) * 100))
                  : 0;
                return (
                  <div className={`forecast-step ${step.allowed ? 'pass' : 'fail'}`} key={step.orderNumber}>
                    <span className="step-num">Order #{step.orderNumber}</span>
                    <div className="step-bar-track">
                      <div className="step-bar-fill" style={{ width: `${remainPct}%` }} />
                    </div>
                    <span className="step-status">
                      {step.allowed
                        ? `PASS · ${money(step.remainingAfterCents)} left`
                        : `BLOCKED · ${step.reasons.map(readable).join(', ')}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="simulator-breakdown">
            {historicalSummary.items.length > 0 && (
              <div className="breakdown-block">
                <h3>Past Purchases Replay ({historicalSummary.passedCount} pass · {historicalSummary.blockedCount} blocked)</h3>
                <div className="breakdown-list">
                  {historicalSummary.items.map(item => (
                    <div className="breakdown-row" key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <small>{item.quantity} units · {money(item.totalCents)} · {readable(item.originalStatus)}</small>
                      </div>
                      <span className={`sim-badge ${item.wouldPass ? 'pass' : 'fail'}`}>
                        {item.wouldPass ? <ShieldCheck size={13} /> : <ShieldX size={13} />}
                        {item.wouldPass ? 'WOULD PASS' : `WOULD BLOCK (${item.reasons.map(readable).join(', ')})`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="breakdown-block">
              <div className="section-heading">
                <h3>Catalog Offers Under Draft Rules</h3>
                <div className="cadence-pills">
                  {(['all', 'allowed', 'blocked'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      className={`button compact ${catalogFilter === mode ? 'primary' : 'secondary'}`}
                      onClick={() => setCatalogFilter(mode)}
                    >
                      {mode === 'all' ? `All (${catalogSummary.totalSkus})` : mode === 'allowed' ? `Allowed (${catalogSummary.allowedSkus})` : `Blocked (${catalogSummary.blockedSkus})`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="breakdown-list catalog-sim-list">
                {visibleCatalog.map(item => (
                  <div className="breakdown-row" key={item.productId}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.category} · {money(item.unitPriceCents)}/unit</small>
                    </div>
                    <span className={`sim-badge ${item.allowed ? 'pass' : 'fail'}`}>
                      {item.allowed ? <ShieldCheck size={13} /> : <ShieldX size={13} />}
                      {item.allowed ? 'ALLOWED' : item.reasons.map(readable).join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="simulator-footer">
            <button type="button" className="button secondary" onClick={onClose}>
              Adjust Rules
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || confirmDisabled}
              onClick={onApply}
            >
              <Check size={15} /> {confirmDisabled ? 'Resolve open purchase first' : 'Confirm These Rules'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
