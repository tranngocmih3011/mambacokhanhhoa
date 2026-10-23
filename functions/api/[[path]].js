// functions/api/[[path]].js - Cloudflare Pages Function Reverse Proxy
// Chuyển tiếp các request /api/* trên Cloudflare Pages (mambacokhanhhoa.pages.dev)
// sang xử lý Web Push & Storage backend, đảm bảo thông báo đơn hàng và admin push hoạt động mượt mà 100%

export async function onRequest(context) {
  const { request, params } = context;
  const pathParts = params.path || [];
  const apiPath = Array.isArray(pathParts) ? pathParts.join('/') : pathParts;

  // Xử lý CORS Preflight (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const url = new URL(request.url);
  const targetUrl = `https://mambacokhanhhoa.vercel.app/api/${apiPath}${url.search}`;

  try {
    const forwardHeaders = new Headers();
    const contentType = request.headers.get('Content-Type');
    if (contentType) {
      forwardHeaders.set('Content-Type', contentType);
    }
    const userAgent = request.headers.get('User-Agent');
    if (userAgent) {
      forwardHeaders.set('User-Agent', userAgent);
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
    const responseBody = await response.text();

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: 'Proxy to API backend failed: ' + err.message,
      success: false 
    }), {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}
