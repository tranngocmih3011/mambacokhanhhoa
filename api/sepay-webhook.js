// api/sepay-webhook.js - Xử lý Webhook tự động từ SePay (sepay.vn)
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BNIqo8uK0d1Fm-43McRzIOp5W0lfQv8XKbWt74wIlDyGwWEOfhct4kDcWyuasywGlAgKR4ft_ZamSMiV90Nbsr8';
const VAPID_PRIVATE_KEY = 'KegP8AMJuN90ptkVt_tvdxi9P7uwXT0fnVPC8x52L-g';
const VAPID_SUBJECT = 'mailto:tranngocmih3011@gmail.com';

const SUBS_STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a15e3ab16c3de8';
const PAID_STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a16276eb5f4f7e';
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec";

const STORAGE_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

async function getPaidData() {
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

  // 1. Khớp chính xác hoàn toàn (BC385011 === BC385011)
  if (p === q) return true;

  // 2. Chứa nhau (BC385011 trong SEVQRBC385011)
  if (p.includes(q) || q.includes(p)) return true;

  // 3. Khớp chính xác toàn bộ chữ số của mã đơn (ví dụ 385011 === 385011)
  const pDigits = p.replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');
  if (pDigits && qDigits && pDigits.length >= 5 && qDigits.length >= 5) {
    if (pDigits === qDigits) return true;
  }

  return false;
}

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Kiểm tra trạng thái thanh toán hoặc xem debug log
  if (req.method === 'GET') {
    const parsedUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const checkOrder = (req.query && req.query.checkOrder) || parsedUrl.searchParams.get('checkOrder');
    const debug = (req.query && req.query.debug) || parsedUrl.searchParams.get('debug');

    const paidData = await getPaidData();
    const paidOrders = paidData.paidOrders || [];

    if (debug) {
      return res.status(200).json({
        status: 'ok',
        paidOrders: paidOrders,
        lastWebhooks: paidData.lastWebhooks || []
      });
    }

    if (!checkOrder) {
      return res.status(200).json({ status: 'ready', message: 'SePay Webhook Endpoint is running' });
    }

    const cleanCheck = String(checkOrder).replace('#', '').trim().toUpperCase();

    // Tìm đơn hàng đã thanh toán khớp theo mã đơn
    let match = paidOrders.find(p => isOrderCodeMatch(p.orderCode, cleanCheck));

    if (match) {
      return res.status(200).json({
        paid: true,
        orderCode: match.orderCode,
        amount: match.amount,
        paidAt: match.paidAt
      });
    }

    return res.status(200).json({
      paid: false,
      orderCode: cleanCheck,
      debug: {
        paidOrdersCount: paidOrders.length,
        codes: paidOrders.map(p => p.orderCode)
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // POST: Nhận Webhook từ SePay khi có biến động số dư tiền vào
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    console.log('SePay Webhook Received:', JSON.stringify(body));

    const paidData = await getPaidData();
    let lastWebhooks = paidData.lastWebhooks || [];
    lastWebhooks.unshift({ receivedAt: new Date().toISOString(), body: body });
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

    // 3. Cập nhật trạng thái đơn hàng trên Google Sheet thành "Đã nhận tiền"
    try {
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'update_order_status',
          orderCode: matchedOrderCode,
          status: 'Đã nhận tiền'
        })
      }).catch(e => console.warn('Lỗi gửi Google Sheet:', e));
    } catch(errSheet) {}

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
