// functions/api/sheet-cache.js
// Cloudflare Edge Cache & Anti-Overload Proxy cho Google Sheet (Ưu tiên 3)
// - GET ?sheet=SanPham|NoiDungWeb|DanhGia|Voucher -> Cache tại Cloudflare Edge 60s (stale-while-revalidate 300s)
// - POST -> Proxy an toàn tới Google Apps Script với tự động retry khi gặp 429/5xx

const SHEET_ID = '1ZvX_-wHeoc6fcv43hW_Jj-blOagtsFJiazorJJ8pBBw';
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec';
const ALLOWED_SHEETS = new Set(['SanPham', 'NoiDungWeb', 'DanhGia', 'Voucher']);

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const sheetName = (url.searchParams.get('sheet') || '').trim();

  if (!ALLOWED_SHEETS.has(sheetName)) {
    return new Response(JSON.stringify({ status: 'error', message: 'Invalid sheet name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/api/sheet-cache?sheet=' + encodeURIComponent(sheetName), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set('X-Edge-Cache', 'HIT');
    return hit;
  }

  const targetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  try {
    const upstream = await fetch(targetUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!upstream.ok) {
      return new Response('', { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
    }
    const csvText = await upstream.text();
    const res = new Response(csvText, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
        'X-Edge-Cache': 'MISS'
      }
    });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', message: 'Upstream timeout' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}

export async function onRequestPost(context) {
  const { request } = context;
  let bodyText = '';
  try {
    bodyText = await request.text();
    if (!bodyText || bodyText.length > 65536) {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    JSON.parse(bodyText);
  } catch (e) {
    return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  // Retry 1 lần nếu Google Apps Script trả 429 hoặc 5xx tạm thời
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyText,
        redirect: 'follow'
      });
      const text = await upstream.text();
      if (upstream.ok || (upstream.status !== 429 && upstream.status < 500)) {
        return new Response(text, {
          status: upstream.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }
      lastErr = 'HTTP ' + upstream.status;
    } catch (err) {
      lastErr = err && err.message ? err.message : 'Network error';
    }
  }

  return new Response(JSON.stringify({ status: 'error', queued: true, message: lastErr || 'Upstream busy' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
