// functions/api/check-payment-status.js — Native Cloudflare Pages Function
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwebXDUV66ufVUa9tWkK5ZFP0WkVwejPf0CfWqwE64TjPU8RBMaQOc1pNRNgyAZwClQuQ/exec';

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
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    let orderId = '';
    let amount = 0;
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      orderId = body.order_id || body.orderCode || body.id || '';
      amount = Number(body.amount || body.total || 0);
    } else {
      const url = new URL(request.url);
      orderId = url.searchParams.get('order_id') || url.searchParams.get('orderCode') || url.searchParams.get('id') || '';
      amount = Number(url.searchParams.get('amount') || url.searchParams.get('total') || 0);
    }

    const cleanOrder = String(orderId || '').replace('#', '').trim().toUpperCase();
    if (!cleanOrder) {
      return jsonRes({ payment_status: 'Unpaid', paid: false, message: 'Thiếu order_id' });
    }

    const res = await fetch(`${gasUrl}?action=check_payment&orderCode=${encodeURIComponent(cleanOrder)}&_t=${Date.now()}`, {
      redirect: 'follow',
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && (data.paid || data.payment_status === 'Paid')) {
        return jsonRes({
          payment_status: 'Paid',
          paid: true,
          order_id: cleanOrder,
          orderCode: cleanOrder,
          amount: data.amount || amount,
          paidAt: data.paidAt || '',
          source: 'google_apps_script',
        });
      }
    }

    return jsonRes({
      payment_status: 'Unpaid',
      paid: false,
      order_id: cleanOrder,
    });
  } catch (e) {
    return jsonRes({ payment_status: 'Unpaid', paid: false }, 200);
  }
}
