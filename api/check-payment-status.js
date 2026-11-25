// api/check-payment-status.js (Hardened)
const STORAGE_URL = process.env.PAID_STORAGE_URL || '';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';

const ALLOWED_ORIGINS = new Set([
  'https://mambacokhanhhoa.pages.dev',
  'https://mambacokhanhhoa.vercel.app'
]);

const STORAGE_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'BaCo-PaymentCheck/2.0'
};

function isOrderCodeMatch(paidCode, queryCode) {
  if (!paidCode || !queryCode) return false;
  const p = String(paidCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const q = String(queryCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!p || !q) return false;
  if (p === q) return true;
  if (p.includes(q) || q.includes(p)) return true;
  const pDigits = p.replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');
  if (pDigits && qDigits && pDigits.length >= 5 && qDigits.length >= 5) {
    if (pDigits === qDigits) return true;
  }
  return false;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mambacokhanhhoa.pages.dev';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let order_id = '';
    let amount = 0;

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      order_id = body.order_id || body.orderCode || body.id || '';
      amount = Number(body.amount || body.total || 0);
    } else {
      const parsedUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      order_id = req.query.order_id || req.query.orderCode || req.query.id || parsedUrl.searchParams.get('order_id') || parsedUrl.searchParams.get('orderCode') || '';
      amount = Number(req.query.amount || req.query.total || parsedUrl.searchParams.get('amount') || 0);
    }

    if (!order_id) {
      return res.status(200).json({ payment_status: 'Unpaid', paid: false, message: 'Thiếu order_id' });
    }

    const cleanOrder = String(order_id).replace('#', '').trim().toUpperCase();

    // 1. Kiểm tra trong bộ nhớ giao dịch SePay (nếu đã cấu hình PAID_STORAGE_URL)
    let match = null;
    if (STORAGE_URL) {
      try {
        const storeRes = await fetch(STORAGE_URL, { headers: STORAGE_HEADERS });
        if (storeRes.ok) {
          const storeData = await storeRes.json();
          const paidOrders = (storeData && storeData.data && storeData.data.paidOrders) || [];
          match = paidOrders.find(p => isOrderCodeMatch(p.orderCode, cleanOrder));
        }
      } catch (e) {
        console.warn('Lỗi đọc storage:', e.message);
      }
    }

    const parsedUrl = req.method !== 'POST' ? new URL(req.url, `https://${req.headers.host || 'localhost'}`) : null;
    const sinceParam = req.method === 'POST' ? (req.body?.since || 0) : (req.query?.since || (parsedUrl ? parsedUrl.searchParams.get('since') : 0));
    const since = Number(sinceParam || 0);

    if (match) {
      const paidTimestamp = match.paidAt ? new Date(match.paidAt).getTime() : 0;
      if (since > 0 && paidTimestamp > 0 && paidTimestamp < (since - 86400000)) {
        match = null;
      }
    }

    if (match) {
      return res.status(200).json({
        payment_status: 'Paid',
        paid: true,
        order_id: match.orderCode,
        orderCode: match.orderCode,
        amount: match.amount,
        paidAt: match.paidAt
      });
    }

    // 2. Kiểm tra trực tiếp qua Google Apps Script API (Script Properties & Sheet riêng tư)
    if (GOOGLE_SCRIPT_URL) {
      try {
        const gasUrl = `${GOOGLE_SCRIPT_URL}?action=check_payment&orderCode=${encodeURIComponent(cleanOrder)}&_t=${Date.now()}`;
        const gasRes = await fetch(gasUrl, { headers: STORAGE_HEADERS, redirect: 'follow' });
        if (gasRes.ok) {
          const gasData = await gasRes.json();
          if (gasData && (gasData.paid || gasData.payment_status === 'Paid')) {
            return res.status(200).json({
              payment_status: 'Paid',
              paid: true,
              order_id: cleanOrder,
              orderCode: cleanOrder,
              amount: gasData.amount || amount,
              source: 'google_apps_script'
            });
          }
        }
      } catch (e) {}
    }

    return res.status(200).json({
      payment_status: 'Unpaid',
      paid: false,
      order_id: cleanOrder
    });

  } catch (error) {
    return res.status(500).json({ payment_status: 'Error', error: 'Internal error' });
  }
};
