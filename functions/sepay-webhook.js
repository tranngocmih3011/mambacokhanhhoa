// functions/sepay-webhook.js - Cloudflare Pages Function
// Route dự phòng nhận SePay Webhook khi khách điền link không có tiền tố /api
export async function onRequest(context) {
  const { request } = context;
  const targetUrl = `https://mambacokhanhhoa.vercel.app/api/sepay-webhook`;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  try {
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (!['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'connection'].includes(lower)) {
        forwardHeaders.set(key, value);
      }
    }
    const fetchInit = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'follow'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchInit.body = await request.text();
    }
    const response = await fetch(targetUrl, fetchInit);
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
