// functions/api/[[path]].js - Cloudflare Pages Function Reverse Proxy (Hardened)
const ALLOWED_ORIGINS = new Set([
  'https://mambacokhanhhoa.pages.dev',
  'https://mambacokhanhhoa.vercel.app',
]);

function resolveCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return 'https://mambacokhanhhoa.pages.dev';
  if (ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.mambacokhanhhoa\.pages\.dev$/i.test(origin)) {
    return origin;
  }
  return 'https://mambacokhanhhoa.pages.dev';
}

export async function onRequest(context) {
  const { request, params } = context;
  const pathParts = params.path || [];
  const apiPath = Array.isArray(pathParts) ? pathParts.join('/') : pathParts;
  const corsOrigin = resolveCorsOrigin(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const url = new URL(request.url);
  let normalizedPath = String(apiPath || '').replace(/[^a-zA-Z0-9_/-]/g, '');
  if (normalizedPath.toLowerCase().includes('sepay') && normalizedPath.toLowerCase().includes('webhook')) {
    normalizedPath = 'sepay-webhook';
  } else if (normalizedPath.toLowerCase().includes('check-payment-status') || normalizedPath.toLowerCase().includes('check_payment_status')) {
    normalizedPath = 'check-payment-status';
  }

  const targetUrl = `https://mambacokhanhhoa.vercel.app/api/${normalizedPath}${url.search}`;

  try {
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (!['host', 'cookie', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'connection'].includes(lower)) {
        forwardHeaders.set(key, value);
      }
    }
    if (!forwardHeaders.has('User-Agent')) {
      forwardHeaders.set('User-Agent', 'Cloudflare-Pages-Proxy');
    }

    const fetchInit = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchInit.body = await request.text();
    }

    const response = await fetch(targetUrl, fetchInit);
    const responseBody = await response.text();

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', corsOrigin);
    responseHeaders.set('Vary', 'Origin');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Upstream service unavailable',
      success: false
    }), {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Vary': 'Origin',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }
}
