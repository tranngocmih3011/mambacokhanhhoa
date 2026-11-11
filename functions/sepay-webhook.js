// functions/sepay-webhook.js - Cloudflare Pages Function (Hardened)
export async function onRequest(context) {
  const { request } = context;
  const targetUrl = `https://mambacokhanhhoa.vercel.app/api/sepay-webhook`;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-store'
      }
    });
  }

  try {
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (!['host', 'cookie', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'connection'].includes(lower)) {
        forwardHeaders.set(key, value);
      }
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
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Webhook upstream error', success: false }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}
