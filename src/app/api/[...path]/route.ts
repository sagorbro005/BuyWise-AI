import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/server/store.mjs';
import { createService } from '@/server/service.mjs';
import { configuration, AppError } from '@/server/providers.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cookieName = 'buywise_session';
const ttl = 7 * 86400000;

async function readBody(request: NextRequest) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('JSON content is required.', 415);
  if (Number(request.headers.get('content-length') || 0) > 65536) throw new AppError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Missing request body.');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new AppError('Request is too large.', 413); }
    parts.push(value);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new AppError('Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('JSON object body is required.', 400);
  return parsed as Record<string, unknown>;
}

async function handle(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await ctx.params).path.join('/');
    const store = getStore(); const service = createService(store);
    if (path === 'health' && request.method === 'GET') return NextResponse.json({ ok: true, environment: 'sandbox' });
    if (path === 'paypal/webhooks' && request.method === 'POST') {
      store.transaction(() => {
        const now = Date.now();
        const rate = store.get('rate', 'webhook-global') || { id: 'webhook-global', owner: 'system', start: now, count: 0 };
        if (now - rate.start > 60000) { rate.start = now; rate.count = 0; }
        if (++rate.count > 60) throw new AppError('Too many webhook requests.', 429);
        store.put('rate', rate);
      });
      return NextResponse.json(await service.webhook(request.headers, await readBody(request)));
    }
    // Require explicit public origin behind a proxy; never trust forwarded host headers.
    const localPort = process.env.PORT || '3000';
    const expectedOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : `http://localhost:${localPort}`;
    const loopbackOrigins = [`http://localhost:${localPort}`, `http://127.0.0.1:${localPort}`];
    const localDemoEnabled = process.env.NODE_ENV === 'development' || process.env.ALLOW_LOCAL_DEMO === 'true';
    const allowedOrigins = process.env.APP_URL ? [expectedOrigin, ...(localDemoEnabled ? loopbackOrigins : [])] : loopbackOrigins;
    if (request.method !== 'GET' && !allowedOrigins.includes(request.headers.get('origin') || '')) throw new AppError('Request origin is not allowed.', 403);
    const rawSid = request.cookies.get(cookieName)?.value;
    let sid = rawSid && /^[a-f0-9]{64}$/.test(rawSid) ? rawSid : undefined;
    let session = sid ? store.get('session', sid) : null;
    let fresh = false;
    if (!session || session.expiresAt < Date.now()) {
      if (request.method !== 'GET' || path !== 'bootstrap') throw new AppError('Session expired. Reload the page.', 401);
      sid = randomBytes(32).toString('hex');
      session = store.put('session', { id: sid, owner: sid, expiresAt: Date.now() + ttl }); fresh = true;
    }
    const owner = session.id;
    if (request.method === 'POST') {
      store.transaction(() => {
        const now = Date.now();
        const rate = store.get('rate', owner) || { id: owner, owner, start: now, count: 0 };
        if (now - rate.start > 60000) { rate.start = now; rate.count = 0; }
        if (++rate.count > 30) throw new AppError('Too many requests. Please wait a minute.', 429);
        store.put('rate', rate);
        if (path === 'agent/propose') {
          const day = new Date().toISOString().slice(0, 10);
          const globalRate = store.get('rate', `ai-${day}`) || { id: `ai-${day}`, owner: 'system', count: 0 };
          if (++globalRate.count > 100) throw new AppError('Daily AI request limit reached. No paid fallback is enabled.', 429);
          store.put('rate', globalRate);
        }
      });
    }
    let result: unknown;
    if (path === 'bootstrap' && request.method === 'GET') result = { ...service.snapshot(owner), config: configuration() };
    else if (request.method === 'POST') {
      const body = await readBody(request);
      if (path === 'mandates') result = service.saveMandate(owner, body);
      else if (path === 'mandates/revoke') result = service.revoke(owner);
      else if (path === 'agent/propose') result = await service.research(owner, body.query);
      else if (path === 'attack') result = service.attack(owner, body);
      else if (path === 'attack/webhook') result = service.attackWebhook(owner, body);
      else if (path === 'intents') result = service.reserve(owner, body);
      else if (['paypal/create', 'paypal/capture', 'paypal/reconcile', 'intents/cancel'].includes(path)) {
        if (typeof body.intentId !== 'string' || !body.intentId || body.intentId.length > 100) throw new AppError('A valid purchase ID is required.');
        if (path === 'paypal/create') result = await service.createOrder(owner, body.intentId);
        if (path === 'paypal/capture') result = await service.capture(owner, body.intentId);
        if (path === 'paypal/reconcile') result = await service.reconcile(owner, body.intentId);
        if (path === 'intents/cancel') result = service.cancel(owner, body.intentId);
      } else throw new AppError('Route not found.', 404);
    } else throw new AppError('Route not found.', 404);
    // The session credential also keys legacy workspace records. Keep it in
    // the HttpOnly cookie and strip it from every browser-facing payload.
    const publicJson = JSON.stringify(result, (key, value) =>
      key === 'owner' ? undefined : value === owner ? 'current-workspace' : value);
    const response = new NextResponse(publicJson, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const localDevelopment = localDemoEnabled && [`localhost:${localPort}`, `127.0.0.1:${localPort}`].includes(request.headers.get('host') || '');
    if (fresh) response.cookies.set(cookieName, owner, { httpOnly: true, sameSite: 'lax', secure: expectedOrigin.startsWith('https:') && !localDevelopment, maxAge: ttl / 1000, path: '/' });
    return response;
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === 'ZodError') return NextResponse.json({ error: 'The submitted values are invalid. Check your quantities and budget.' }, { status: 400 });
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return NextResponse.json({ error: 'The provider timed out. If this was a payment, check payment status before retrying.' }, { status: 504 });
    console.error('BuyWise request failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'The request could not be completed. Please retry or check payment status.' }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
