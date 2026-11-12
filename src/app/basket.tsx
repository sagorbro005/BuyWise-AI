'use client';

import { useState } from 'react';
import { OfferGrid, type Research } from './offer-comparison';
import { categoryLabels } from '../core/categories.mjs';

const price = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
type Product = { id: string; category: string; name: string; unitPriceCents: number };
export type BasketEntry = { product: Product; quantity: number };
export type BasketResult = {
  kind: 'basket'; outcome: string; message?: string; recommendationId: string | null; entries: BasketEntry[];
  spendingLimitCents?: number;
  decision?: { totalCents: number; quantity: number; reasons: string[] };
  groups: { id: string; request: { productQuery: string; quantity: number | null }; rows: Research['rows'] }[];
};

export function BasketLines({ entries }: { entries: BasketEntry[] }) {
  const combined = new Map<string, BasketEntry>();
  for (const line of entries) {
    const quantity = line.quantity + (combined.get(line.product.id)?.quantity ?? 0);
    combined.set(line.product.id, { product: line.product, quantity });
  }
  return <ul>{Array.from(combined.values(), ({ product, quantity }) =>
    <li key={product.id}>{quantity} × {product.name} at {price(product.unitPriceCents)} = <strong>{price(quantity * product.unitPriceCents)}</strong></li>)}</ul>;
}

export function BasketComparison({ result, busy, review, clear }: {
  result: BasketResult; busy: boolean; review: (id: string) => void; clear: () => void;
}) {
  return <section className="panel comparison-panel">
    <h2>{result.outcome === 'no_match' ? 'No complete basket' : 'Your proposed basket'}</h2>
    {result.message && <p>{result.message}</p>}
    <BasketLines entries={result.entries}/>
    {result.decision && <p><strong>{price(result.decision.totalCents)} combined</strong> · {result.decision.quantity} units</p>}
    {!!result.decision?.reasons.length && <p role="status">Basket blocked: {result.decision.reasons.join(', ').toLowerCase().replaceAll('_', ' ')}</p>}
    <h3>Why this choice?</h3>
    {result.outcome === 'match' && result.decision && <p>
      All requested lines fit together. {result.spendingLimitCents != null &&
        `${price(result.decision.totalCents)} of the ${price(result.spendingLimitCents)} effective spending limit leaves ${price(result.spendingLimitCents - result.decision.totalCents)} for this order.`}
      {' '}Among combinations that passed, BuyWise used the combined preference rankings and then the lower total to break ties.
    </p>}
    {result.outcome === 'blocked' && <p>The combination below failed the whole-order checks. Individual line checks are shown for comparison.</p>}
    {result.outcome === 'no_match' && <p>BuyWise needs a suitable option for every requested line before it can propose a complete basket.</p>}
    {result.groups.map((g, index) => {
      const selected = result.entries[index]?.product;
      return <section className="basket-offers" key={g.id} aria-label={g.request.productQuery}>
        <h4>{g.request.quantity ?? 1} × {g.request.productQuery}</h4>
        {selected && <p>{result.outcome === 'match' ? 'Selected' : 'Evaluated'}: <strong>{selected.name}</strong></p>}
        {g.rows.length ? <OfferGrid rows={g.rows} basket selectedId={selected?.id}
          selectionLabel={result.outcome === 'match' ? 'Selected' : 'Evaluated'}/> : <p>No listings in the approved categories.</p>}
      </section>;
    })}
    <div className="checkout-actions">
      {result.recommendationId && <button type="button" className="button primary" disabled={busy}
        onClick={() => result.recommendationId && review(result.recommendationId)}>Review whole basket</button>}
      <button type="button" className="button secondary" onClick={clear}>Back to catalog</button>
    </div>
  </section>;
}

export function BasketBuilder({ products, busy, review }: {
  products: Product[]; busy: boolean; review: (lines: {productId: string; quantity: number}[]) => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const lines = products.filter(p => Number(counts[p.id]) > 0).map(product => ({ product, quantity: Number(counts[product.id]) }));
  const totalUnits = lines.reduce((n, l) => n + l.quantity, 0);
  const totalCents = lines.reduce((n, l) => n + l.quantity * l.product.unitPriceCents, 0);

  const grouped = new Map<string, Product[]>();
  for (const product of products) {
    const list = grouped.get(product.category) ?? [];
    list.push(product);
    grouped.set(product.category, list);
  }

  return (
    <section className="panel comparison-panel basket-builder-panel">
      <div className="basket-builder-header">
        <div>
          <h2>Build a basket</h2>
          <p className="basket-subtitle">Mix up to 6 product lines across your allowed categories.</p>
        </div>
        <span className="count-chip">{lines.length} / 6 lines</span>
      </div>
      <form
        className="basket-builder-form"
        onSubmit={e => {
          e.preventDefault();
          void review(lines.map(line => ({ productId: line.product.id, quantity: line.quantity })));
        }}
      >
        <div className="basket-categories">
          {Array.from(grouped.entries()).map(([catId, items]) => (
            <div className="basket-category-group" key={catId}>
              <div className="basket-category-title">
                <strong>{categoryLabels[catId as keyof typeof categoryLabels] ?? catId}</strong>
                <span>{items.length} items</span>
              </div>
              <div className="basket-grid">
                {items.map(p => {
                  const qty = Number(counts[p.id] || 0);
                  return (
                    <label className={`basket-pick-card ${qty > 0 ? 'active' : ''}`} key={p.id}>
                      <div className="basket-pick-info">
                        <strong>{p.name}</strong>
                        <span>{price(p.unitPriceCents)} each</span>
                      </div>
                      <input
                        className="policy-field basket-qty-input"
                        aria-label={`Units of ${p.name}`}
                        type="number"
                        min="0"
                        max="50"
                        step="1"
                        placeholder="0"
                        value={counts[p.id] ?? ''}
                        onChange={e => setCounts({ ...counts, [p.id]: e.target.value })}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="basket-summary-bar">
          <div className="basket-summary-totals">
            <span>{totalUnits} {totalUnits === 1 ? 'unit' : 'units'}</span>
            <strong>{price(totalCents)} combined</strong>
          </div>
          <div className="basket-summary-actions">
            {lines.length > 0 && (
              <button type="button" className="text-button" onClick={() => setCounts({})}>
                Clear
              </button>
            )}
            <button className="button primary" type="submit" disabled={busy || !lines.length || lines.length > 6}>
              Review whole basket
            </button>
          </div>
        </div>
        {lines.length > 6 && <p className="basket-limit-warning">Choose up to six product lines per basket.</p>}
      </form>
    </section>
  );
}
