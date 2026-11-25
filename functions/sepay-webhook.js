// functions/sepay-webhook.js — Native Cloudflare Pages Function (Hardened)
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwebXDUV66ufVUa9tWkK5ZFP0WkVwejPf0CfWqwE64TjPU8RBMaQOc1pNRNgyAZwClQuQ/exec';

function timingSafeEqualStr(a, b) {
  const sa = new TextEncoder().encode(String(a || ''));
  const sb = new TextEncoder().encode(String(b || ''));
  if (sa.length === 0 || sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa[i] ^ sb[i];
  }
  return diff === 0;
}

function findBcCode(str) {
  if (!str) return '';
  const s = String(str).toUpperCase();
  const patterns = [
    /BC\d{4,9}/i,
    /\bBC[A-Z0-9]{4,10}\b/i,
    /SEVQR\s*BC(\d{4,9})/i,
    /SEVQR\s*(?:DH|DON)?\s*(\d{4,9})/i,
    /BC\s*(\d{5,9})/i,
    /(?:SEVQR|SEPAY|BACO)\s*(\d{5,9})/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return (m[1] ? 'BC' + m[1] : m[0]).replace(/[^A-Z0-9]/g, '');
  }
  return '';
}

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const gasUrl = (env && env.GOOGLE_SCRIPT_URL) || DEFAULT_GAS_URL;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sepay-Secret',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const checkOrder = (url.searchParams.get('checkOrder') || '').replace('#', '').trim().toUpperCase();
    if (!checkOrder) {
      return jsonRes({ status: 'ready', message: 'Cloudflare SePay Webhook is running' });
    }
    try {
      const r = await fetch(`${gasUrl}?action=check_payment&orderCode=${encodeURIComponent(checkOrder)}&_t=${Date.now()}`, {
        redirect: 'follow',
      });
      const data = await r.json();
      return jsonRes({
        paid: !!(data && (data.paid || data.payment_status === 'Paid')),
        orderCode: checkOrder,
        amount: (data && data.amount) || 0,
        paidAt: (data && data.paidAt) || '',
      });
    } catch (e) {
      return jsonRes({ paid: false, orderCode: checkOrder });
    }
  }

  if (request.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const sepaySecret = (env && env.SEPAY_WEBHOOK_SECRET) || '';
  const gasWebhookSecret = (env && env.GAS_WEBHOOK_SECRET) || '';
  if (!sepaySecret || !gasWebhookSecret) {
    return jsonRes({ error: 'Webhook secrets not configured on Cloudflare Pages' }, 503);
  }

  const authHeader = String(request.headers.get('Authorization') || '').trim();
  const headerSecret = String(request.headers.get('X-Sepay-Secret') || '').trim();
  const provided = authHeader.replace(/^(Apikey|Bearer)\s+/i, '').trim();
  if (!timingSafeEqualStr(provided, sepaySecret) && !timingSafeEqualStr(headerSecret, sepaySecret)) {
    return jsonRes({ error: 'Unauthorized webhook' }, 401);
  }

  try {
    const body = await request.json();
    const transferType = String(body.transferType || body.type || 'in').toLowerCase();
    if (transferType && transferType !== 'in') {
      return jsonRes({ success: true, message: 'Ignored outgoing transaction' });
    }

    const amount = Number(body.transferAmount || body.amount || 0);
    const rawContent = String(body.content || body.description || body.order_code || body.code || '');
    const matchedCode =
      findBcCode(body.code) ||
      findBcCode(body.content) ||
      findBcCode(body.description) ||
      findBcCode(body.order_code) ||
      '';

    if (!matchedCode || amount <= 0) {
      return jsonRes({ success: true, message: 'No valid BC orderCode or amount' });
    }

    const gasRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'sepay_webhook',
        webhookSecret: gasWebhookSecret,
        orderCode: matchedCode,
        amount,
        gateway: body.gateway || 'VietinBank',
        content: rawContent,
        transferType,
        referenceCode: body.referenceCode || '',
      }),
      redirect: 'follow',
    });
    const gasData = await gasRes.json().catch(() => ({}));
    return jsonRes({
      success: gasData.status === 'success',
      orderCode: matchedCode,
      amount,
      underpaid: !!gasData.underpaid,
    });
  } catch (err) {
    return jsonRes({ error: 'Invalid webhook payload' }, 400);
  }
}
