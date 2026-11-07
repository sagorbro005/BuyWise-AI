'use client';

import { AgGridReact } from 'ag-grid-react';
import { themeQuartz } from 'ag-grid-community';

type Offer = {
  productId: string; name: string; description: string; quantity: number; totalCents: number;
  featureFit: boolean; features: { feature: string; evidence: string | null }[];
  requestReasons: string[]; policyReasons: string[]; overBudgetCents: number | null;
};
export type Research = {
  outcome: 'match' | 'blocked' | 'no_match';
  recommendationId: string | null;
  message?: string;
  proposal: { productId: string; quantity: number; explanation: string } | null;
  parsedRequest: { productQuery: string; category: string; quantity: number | null; budgetCents: number | null; currency: string | null; requirements: string[] };
  rows: Offer[];
};

const dollars = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const reasons = (codes: string[]) => codes.map(code => code.toLowerCase().replaceAll('_', ' ')).join(', ');
function productFit(row: Offer) {
  if (row.requestReasons.includes('REQUEST_CATEGORY_MISMATCH')) return 'Different category';
  if (!row.features.length) return row.description;
  return row.features.map(f => f.evidence ? `${f.feature}: “${f.evidence}”` : `${f.feature}: unconfirmed`).join(' · ');
}
export default function OfferComparison({ result, busy, review, clear }: {
  result: Research; busy: boolean; review: (id: string) => void; clear: () => void;
}) {
  const request = result.parsedRequest;
  return <section className="panel comparison-panel" aria-label="Product comparison">
    <h2>{result.outcome === 'no_match' ? 'No suitable match' : 'Why this choice?'}</h2>
    <p>{result.message ?? result.proposal?.explanation}</p>
    {result.outcome === 'blocked' && <p role="status">AgentGuard blocked this recommendation under the current mandate.</p>}
    <p className="muted">Comparing {request.quantity ?? 1} unit(s) · {request.productQuery}
      {request.budgetCents !== null && ` · Request budget ${(request.budgetCents / 100).toFixed(2)} ${request.currency ?? 'USD'}`}</p>
    <AgGridReact<Offer> domLayout="autoHeight" theme={themeQuartz.withParams({
      backgroundColor: 'var(--surface)', foregroundColor: 'var(--ink)', borderColor: 'var(--border)', headerBackgroundColor: 'var(--inset)',
    })} rowData={result.rows} getRowId={p => p.data.productId}
      defaultColDef={{ sortable: true, resizable: true, wrapText: true, autoHeight: true }}
      columnDefs={[
        { field: 'name', headerName: 'Product', minWidth: 140 },
        { field: 'totalCents', headerName: 'Total', width: 98, valueFormatter: p => dollars(p.value) },
        { headerName: 'Product fit · listing evidence', minWidth: 220, flex: 1, valueGetter: p => p.data && productFit(p.data) },
        { headerName: 'Request budget', width: 150, valueGetter: p => {
          if (p.data?.requestReasons.includes('REQUEST_CURRENCY_MISMATCH')) return 'Currency mismatch';
          const over = p.data?.overBudgetCents;
          return over == null ? 'Unspecified' : over ? `${dollars(over)} over` : 'Within budget';
        } },
        { headerName: 'Mandate check', width: 155, valueGetter: p => p.data && (reasons(p.data.policyReasons) || 'Allowed') },
      ]}/>
    <div className="checkout-actions">
      {result.outcome === 'match' && result.recommendationId && <button type="button" className="button primary" disabled={busy}
        onClick={() => result.recommendationId && review(result.recommendationId)}>Review {result.rows.find(row => row.productId === result.proposal?.productId)?.name}</button>}
      <button type="button" className="button secondary" onClick={clear}>Back to catalog</button>
    </div>
  </section>;
}
