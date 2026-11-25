// api/sepay-webhook.js - Xử lý Webhook tự động từ SePay (Hardened)
const crypto = require('crypto');
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mambacokhanhhoa.pages.dev';

const SUBS_STORAGE_URL = process.env.SUBS_STORAGE_URL || '';
const PAID_STORAGE_URL = process.env.PAID_STORAGE_URL || '';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET || '';
const GAS_WEBHOOK_SECRET = process.env.GAS_WEBHOOK_SECRET || '';

const ALLOWED_ORIGINS = new Set([
  'https://mambacokhanhhoa.pages.dev',
  'https://mambacokhanhhoa.vercel.app'
]);

const STORAGE_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'BaCo-Webhook/2.0'
};

function timingSafeEqualStr(a, b) {
  const sa = Buffer.from(String(a || ''), 'utf8');
  const sb = Buffer.from(String(b || ''), 'utf8');
  if (sa.length === 0 || sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(sa, sb);
}

async function getPaidData() {
  if (!PAID_STORAGE_URL) return { paidOrders: [], lastWebhooks: [] };
  try {
    const res = await fetch(PAID_STORAGE_URL, { headers: STORAGE_HEADERS });
    if (res.ok) {
      const json = await res.json();
      return (json && json.data) || { paidOrders: [], lastWebhooks: [] };
    }
  } catch (e) {
    console.error('getPaidData error:', e.message);
  }
  return { paidOrders: [], lastWebhooks: [] };
}

async function savePaidData(data) {
  if (!PAID_STORAGE_URL) return false;
  try {
    const res = await fetch(PAID_STORAGE_URL, {
      method: 'PUT',
      headers: STORAGE_HEADERS,
      body: JSON.stringify({
        name: 'baco_paid_orders',
        data: data
      })
    });
    return res.ok;
  } catch (e) {
    console.error('savePaidData error:', e.message);
    return false;
  }
}

async function getSubsAndTelegram() {
  if (!SUBS_STORAGE_URL) return {};
  try {
    const res = await fetch(SUBS_STORAGE_URL, { headers: STORAGE_HEADERS });
    if (res.ok) {
      const json = await res.json();
      return (json && json.data) || {};
    }
  } catch(e) {}
  return {};
}

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

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mambacokhanhhoa.pages.dev';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Sepay-Secret');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Kiểm tra trạng thái thanh toán (đã gỡ ?debug=1 để không lộ dữ liệu giao dịch)
  if (req.method === 'GET') {
    const parsedUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const checkOrder = (req.query && req.query.checkOrder) || parsedUrl.searchParams.get('checkOrder');

    if (!checkOrder) {
      return res.status(200).json({ status: 'ready', message: 'SePay Webhook Endpoint is running' });
    }

    const paidData = await getPaidData();
    const paidOrders = paidData.paidOrders || [];
    const cleanCheck = String(checkOrder).replace('#', '').trim().toUpperCase();
    const match = paidOrders.find(p => isOrderCodeMatch(p.orderCode, cleanCheck));

    if (match) {
      return res.status(200).json({
        paid: true,
        orderCode: match.orderCode,
        amount: match.amount,
        paidAt: match.paidAt
      });
    }

    return res.status(200).json({ paid: false, orderCode: cleanCheck });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Xác thực chữ ký / API Key từ SePay Webhook (Fail-closed nếu chưa cấu hình SEPAY_WEBHOOK_SECRET)
  if (!SEPAY_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook secret not configured on server' });
  }
  const authHeader = String(req.headers.authorization || '').trim();
  const headerSecret = String(req.headers['x-sepay-secret'] || '').trim();
  const bearerOrApiKey = authHeader.replace(/^(Apikey|Bearer)\s+/i, '').trim();
  if (!timingSafeEqualStr(bearerOrApiKey, SEPAY_WEBHOOK_SECRET) && !timingSafeEqualStr(headerSecret, SEPAY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized webhook' });
  }

  // POST: Nhận Webhook từ SePay khi có biến động số dư tiền vào
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const paidData = await getPaidData();
    let lastWebhooks = paidData.lastWebhooks || [];
    lastWebhooks.unshift({ receivedAt: new Date().toISOString(), id: body.id || body.referenceCode || '' });
    if (lastWebhooks.length > 10) lastWebhooks = lastWebhooks.slice(0, 10);
    paidData.lastWebhooks = lastWebhooks;

    const transferType = body.transferType || body.type || 'in';
    const amount = Number(body.transferAmount || body.amount || 0);
    const rawContent = String(body.content || body.description || body.order_code || body.code || '');

    // Chỉ xử lý giao dịch tiền vào (tiền cộng vào tài khoản)
    if (transferType && transferType.toLowerCase() !== 'in') {
      await savePaidData(paidData);
      return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch tiền ra' });
    }

    // 1. Trích xuất mã đơn hàng từ SePay (dạng BCxxxxxx hoặc chuỗi số)
    let matchedOrderCode = '';

    const findBcCode = (str) => {
      if (!str) return '';
      const s = String(str).toUpperCase();
      const m1 = s.match(/BC\d{4,9}/i);
      if (m1) return m1[0].toUpperCase();
      const m2 = s.match(/\bBC[A-Z0-9]{4,10}\b/i);
      if (m2) return m2[0].toUpperCase();
      const m3 = s.match(/SEVQR\s*BC(\d{4,9})/i);
      if (m3) return ('BC' + m3[1]).toUpperCase();
      const m4 = s.match(/SEVQR\s*(\d{5,9})/i);
      if (m4) return ('BC' + m4[1]).toUpperCase();
      const m5 = s.match(/SEVQR\s*(?:DH|DON)?\s*(\d{4,9})/i);
      if (m5) return ('BC' + m5[1]).toUpperCase();
      const m6 = s.match(/BC\s*(\d{5,9})/i);
      if (m6) return ('BC' + m6[1]).toUpperCase();
      const m7 = s.match(/(?:SEVQR|SEPAY|BACO)\s*(\d{5,9})/i);
      if (m7) return ('BC' + m7[1]).toUpperCase();
      return '';
    };

    if (body.code) matchedOrderCode = findBcCode(body.code);
    if (!matchedOrderCode && body.content) matchedOrderCode = findBcCode(body.content);
    if (!matchedOrderCode && body.description) matchedOrderCode = findBcCode(body.description);
    if (!matchedOrderCode && body.order_code) matchedOrderCode = findBcCode(body.order_code);

    if (!matchedOrderCode && body.code) {
      matchedOrderCode = String(body.code).replace('#', '').trim().toUpperCase();
    }

    if (!matchedOrderCode) {
      console.log('Không tìm thấy mã đơn BC trong nội dung SePay:', rawContent);
      await savePaidData(paidData);
      return res.status(200).json({
        success: true,
        message: 'Giao dịch không chứa mã đơn BC hợp lệ',
        content: rawContent
      });
    }

    console.log(`Tìm thấy đơn hàng thanh toán SePay: #${matchedOrderCode} - Số tiền: ${amount}đ`);

    // 2. Lưu trạng thái Đã Thanh Toán vào Storage chuẩn để Web khách hàng tự động nhảy thành công
    let paidOrders = paidData.paidOrders || [];
    const existingIdx = paidOrders.findIndex(p => isOrderCodeMatch(p.orderCode, matchedOrderCode));
    const paidRecord = {
      orderCode: matchedOrderCode,
      amount: amount,
      paidAt: new Date().toISOString(),
      gateway: body.gateway || '',
      referenceCode: body.referenceCode || ''
    };

    if (existingIdx >= 0) {
      paidOrders[existingIdx] = paidRecord;
    } else {
      paidOrders.unshift(paidRecord);
    }

    // Giữ tối đa 50 đơn đã thanh toán gần nhất
    if (paidOrders.length > 50) paidOrders = paidOrders.slice(0, 50);
    paidData.paidOrders = paidOrders;

    const saveSuccess = await savePaidData(paidData);
    console.log('Cập nhật Storage SePay thành công:', saveSuccess);

    // 3. Cập nhật trạng thái thanh toán lên Google Apps Script & Google Sheet
    if (GOOGLE_SCRIPT_URL && GAS_WEBHOOK_SECRET) {
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'sepay_webhook',
            webhookSecret: GAS_WEBHOOK_SECRET,
            orderCode: matchedOrderCode,
            amount: amount,
            gateway: body.gateway || 'VietinBank',
            content: rawContent,
            transferType: transferType,
            referenceCode: body.referenceCode || ''
          })
        });
      } catch(errSheet) {
        console.warn('Lỗi gửi Google Sheet:', errSheet.message);
      }
    }

    // 4. Bắn Thông Báo Đẩy (Web Push) về iPhone của Admin
    const subData = await getSubsAndTelegram();
    const subs = subData.subs || [];
    if (subs.length > 0) {
      const pushPayload = JSON.stringify({
        title: `💰 ĐÃ NHẬN TIỀN #${matchedOrderCode} - ${amount.toLocaleString('vi-VN')}đ`,
        body: `Khách đã chuyển khoản thành công qua SePay (${body.gateway || 'Ngân hàng'}). Vui lòng chuẩn bị hàng!`,
        url: './admin.html?viewNotif=' + encodeURIComponent(matchedOrderCode),
        code: matchedOrderCode,
        type: 'orders'
      });

      Promise.allSettled(
        subs.map(s => webpush.sendNotification(s, pushPayload, { TTL: 86400, urgency: 'high' }))
      ).catch(e => console.warn('Lỗi push admin:', e));
    }

    // 5. Gửi thông báo Telegram nếu có cấu hình
    const telegram = subData.telegram || {};
    if (telegram.botToken && telegram.chatId) {
      try {
        const tgText = `💰 <b>SEPAY XÁC NHẬN TIỀN VỀ TÀI KHOẢN!</b>\n\n` +
                       `📌 <b>Mã đơn:</b> <code>#${matchedOrderCode}</code>\n` +
                       `💵 <b>Số tiền:</b> <code>${amount.toLocaleString('vi-VN')} đ</code>\n` +
                       `🏦 <b>Ngân hàng:</b> ${body.gateway || 'Tự động'}\n` +
                       `📝 <b>Nội dung:</b> ${rawContent}\n` +
                       `⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}\n\n` +
                       `👉 <a href="https://mambacokhanhhoa.vercel.app/admin.html?viewNotif=${encodeURIComponent(matchedOrderCode)}">Xem chi tiết đơn hàng trong Admin</a>`;

        fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram.chatId,
            text: tgText,
            parse_mode: 'HTML'
          })
        }).catch(() => {});
      } catch(e) {}
    }

    return res.status(200).json({
      success: true,
      message: `Đã xác nhận thanh toán đơn #${matchedOrderCode} thành công!`,
      orderCode: matchedOrderCode,
      amount: amount,
      storageSaved: saveSuccess
    });

  } catch(error) {
    console.error('Lỗi SePay Webhook:', error);
    return res.status(500).json({ error: error.message });
  }
};
