// api/sepay-webhook.js - Xử lý Webhook tự động từ SePay (sepay.vn)
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BNIqo8uK0d1Fm-43McRzIOp5W0lfQv8XKbWt74wIlDyGwWEOfhct4kDcWyuasywGlAgKR4ft_ZamSMiV90Nbsr8';
const VAPID_PRIVATE_KEY = 'KegP8AMJuN90ptkVt_tvdxi9P7uwXT0fnVPC8x52L-g';
const VAPID_SUBJECT = 'mailto:tranngocmih3011@gmail.com';

const STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a15e3ab16c3de8';
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec";

const STORAGE_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

async function getStorageData() {
  try {
    const res = await fetch(STORAGE_URL, { headers: STORAGE_HEADERS });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error('getStorageData error:', e.message);
  }
  return null;
}

let lastStorageError = null;
async function saveStorageData(data) {
  try {
    const res = await fetch(STORAGE_URL, {
      method: 'PUT',
      headers: STORAGE_HEADERS,
      body: JSON.stringify({
        name: 'baco_subscriptions',
        data: data
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      lastStorageError = { status: res.status, text: errText };
      console.error('saveStorageData failed:', res.status, errText);
      return false;
    }
    return true;
  } catch (e) {
    lastStorageError = { error: e.message };
    console.error('saveStorageData exception:', e.message);
    return false;
  }
}

function isOrderCodeMatch(paidCode, queryCode) {
  if (!paidCode || !queryCode) return false;
  const p = String(paidCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const q = String(queryCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!p || !q) return false;

  // 1. Khớp chính xác hoàn toàn (ví dụ: BC7006885 === BC7006885)
  if (p === q) return true;

  // 2. Một chuỗi chứa chuỗi còn lại (ví dụ: BC7006885 chứa BC700688)
  if (p.includes(q) || q.includes(p)) return true;

  // 3. Khớp phần chữ số (ví dụ: 700688 trong 7006885)
  const pDigits = p.replace(/\D/g, '');
  const qDigits = q.replace(/\D/g, '');
  if (pDigits && qDigits) {
    if (pDigits === qDigits) return true;
    if (pDigits.length >= 4 && qDigits.length >= 4) {
      if (pDigits.includes(qDigits) || qDigits.includes(pDigits)) return true;
    }
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
    const queryAmount = Number((req.query && req.query.amount) || parsedUrl.searchParams.get('amount') || 0);
    const debug = (req.query && req.query.debug) || parsedUrl.searchParams.get('debug');

    const storeData = await getStorageData();
    const paidOrders = (storeData && storeData.data && storeData.data.paidOrders) || [];

    if (debug) {
      return res.status(200).json({
        status: 'ok',
        lastWebhooks: (storeData && storeData.data && storeData.data.lastWebhooks) || [],
        paidOrders: paidOrders
      });
    }

    if (!checkOrder) {
      return res.status(200).json({ status: 'ready', message: 'SePay Webhook Endpoint is running' });
    }

    const cleanCheck = String(checkOrder).replace('#', '').trim().toUpperCase();

    // 1. Tìm đơn hàng đã thanh toán khớp theo mã (chính xác hoặc tương đối)
    let match = paidOrders.find(p => isOrderCodeMatch(p.orderCode, cleanCheck));

    // 2. Nếu không khớp theo mã nhưng có truyền số tiền, tìm giao dịch gần nhất (trong vòng 30 phút) có số tiền tương ứng
    if (!match && queryAmount > 0) {
      match = paidOrders.find(p => {
        if (Math.abs(Number(p.amount) - queryAmount) < 100) {
          const paidTime = new Date(p.paidAt).getTime();
          const diffMinutes = (Date.now() - paidTime) / 60000;
          return diffMinutes >= 0 && diffMinutes <= 30;
        }
        return false;
      });
    }

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

    // Lấy dữ liệu lưu trữ hiện tại
    let storeData = await getStorageData();
    if (!storeData || !storeData.data) {
      storeData = { name: 'baco_subscriptions', data: { subs: [], paidOrders: [], lastWebhooks: [] } };
    }

    // Lưu raw webhook log để kiểm tra
    try {
      let list = storeData.data.lastWebhooks || [];
      list.unshift({ receivedAt: new Date().toISOString(), body: body });
      if (list.length > 10) list = list.slice(0, 10);
      storeData.data.lastWebhooks = list;
    } catch(e) {}

    // Các trường dữ liệu từ SePay:
    // transferType: "in" (tiền vào)
    // transferAmount: số tiền
    // content: nội dung chuyển khoản
    // code: mã thanh toán do SePay nhận diện
    // gateway: VietinBank, MBBank, Vietcombank,...
    const transferType = body.transferType || body.type || 'in';
    const amount = Number(body.transferAmount || body.amount || 0);
    const rawContent = String(body.content || body.description || body.order_code || body.code || '');

    // Chỉ xử lý giao dịch tiền vào (tiền cộng vào tài khoản)
    if (transferType && transferType.toLowerCase() !== 'in') {
      await saveStorageData(storeData.data);
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
      await saveStorageData(storeData.data);
      return res.status(200).json({
        success: true,
        message: 'Giao dịch không chứa mã đơn BC hợp lệ',
        content: rawContent
      });
    }

    console.log(`Tìm thấy đơn hàng thanh toán SePay: #${matchedOrderCode} - Số tiền: ${amount}đ`);

    // 2. Lưu trạng thái Đã Thanh Toán vào Storage để Web khách hàng tự động nhảy thành công
    let paidOrders = storeData.data.paidOrders || [];
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
      paidOrders.push(paidRecord);
    }

    // Giữ tối đa 50 đơn đã thanh toán gần nhất
    if (paidOrders.length > 50) paidOrders = paidOrders.slice(-50);
    storeData.data.paidOrders = paidOrders;

    const saveSuccess = await saveStorageData(storeData.data);
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
    const subs = (storeData && storeData.data && storeData.data.subs) || [];
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
    const telegram = (storeData && storeData.data && storeData.data.telegram) || {};
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
      storageSaved: saveSuccess,
      storageError: lastStorageError
    });

  } catch(error) {
    console.error('Lỗi SePay Webhook:', error);
    return res.status(500).json({ error: error.message });
  }
};
