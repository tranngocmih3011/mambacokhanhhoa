// api/sepay-webhook.js - Xử lý Webhook tự động từ SePay (sepay.vn)
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BNIqo8uK0d1Fm-43McRzIOp5W0lfQv8XKbWt74wIlDyGwWEOfhct4kDcWyuasywGlAgKR4ft_ZamSMiV90Nbsr8';
const VAPID_PRIVATE_KEY = 'KegP8AMJuN90ptkVt_tvdxi9P7uwXT0fnVPC8x52L-g';
const VAPID_SUBJECT = 'mailto:tranngocmih3011@gmail.com';

const STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a15e3ab16c3de8';
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec";

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
    const { checkOrder, debug } = req.query || {};

    if (debug) {
      try {
        const storeRes = await fetch(STORAGE_URL, { cache: 'no-store' });
        if (storeRes.ok) {
          const storeData = await storeRes.json();
          return res.status(200).json({
            status: 'ok',
            lastWebhooks: (storeData && storeData.data && storeData.data.lastWebhooks) || [],
            paidOrders: (storeData && storeData.data && storeData.data.paidOrders) || []
          });
        }
      } catch(e) {}
    }

    if (!checkOrder) {
      return res.status(200).json({ status: 'ready', message: 'SePay Webhook Endpoint is running' });
    }

    const cleanCheck = String(checkOrder).replace('#', '').trim().toUpperCase();

    try {
      const storeRes = await fetch(STORAGE_URL, { cache: 'no-store' });
      if (storeRes.ok) {
        const storeData = await storeRes.json();
        const paidOrders = (storeData && storeData.data && storeData.data.paidOrders) || [];
        const match = paidOrders.find(p => String(p.orderCode).replace('#', '').trim().toUpperCase() === cleanCheck);
        if (match) {
          return res.status(200).json({
            paid: true,
            orderCode: match.orderCode,
            amount: match.amount,
            paidAt: match.paidAt
          });
        }
      }
    } catch(e) {
      console.warn('Lỗi đọc storage checkOrder:', e);
    }

    return res.status(200).json({ paid: false, orderCode: cleanCheck });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // POST: Nhận Webhook từ SePay khi có biến động số dư tiền vào
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    console.log('SePay Webhook Received:', JSON.stringify(body));

    // Lưu raw webhook log để kiểm tra
    try {
      const storeRes = await fetch(STORAGE_URL, { cache: 'no-store' });
      if (storeRes.ok) {
        const sData = await storeRes.json();
        if (sData && sData.data) {
          let list = sData.data.lastWebhooks || [];
          list.unshift({ receivedAt: new Date().toISOString(), body: body });
          if (list.length > 10) list = list.slice(0, 10);
          sData.data.lastWebhooks = list;
          await fetch(STORAGE_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'baco_subscriptions', data: sData.data })
          });
        }
      }
    } catch(e) {}

    // Các trường dữ liệu từ SePay:
    // transferType: "in" (tiền vào)
    // transferAmount: số tiền
    // content: nội dung chuyển khoản (chứa mã đơn ví dụ: BC123456)
    // code: mã thanh toán do SePay tự nhận diện
    // gateway: VietinBank, MBBank, Vietcombank,...
    // referenceCode, transactionDate
    const transferType = body.transferType || body.type || 'in';
    const amount = Number(body.transferAmount || body.amount || 0);
    const rawContent = String(body.content || body.description || body.order_code || body.code || '');

    // Chỉ xử lý giao dịch tiền vào (tiền cộng vào tài khoản)
    if (transferType && transferType.toLowerCase() !== 'in') {
      return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch tiền ra' });
    }

    // 1. Trích xuất mã đơn hàng từ SePay (dạng BCxxxxxx hoặc chuỗi số)
    let matchedOrderCode = '';
    if (body.code) {
      const c = String(body.code).replace('#', '').trim().toUpperCase();
      if (/^BC[A-Z0-9]{4,10}$/i.test(c)) {
        matchedOrderCode = c;
      }
    }
    if (!matchedOrderCode) {
      const bcMatch = rawContent.match(/BC\d{4,8}/i) || rawContent.match(/\b(BC[A-Z0-9]{4,10})\b/i);
      if (bcMatch) {
        matchedOrderCode = bcMatch[0].toUpperCase();
      }
    }
    if (!matchedOrderCode && body.order_code) {
      matchedOrderCode = String(body.order_code).replace('#', '').trim().toUpperCase();
    }

    if (!matchedOrderCode) {
      console.log('Không tìm thấy mã đơn BC trong nội dung SePay:', rawContent);
      return res.status(200).json({
        success: true,
        message: 'Giao dịch không chứa mã đơn BC hợp lệ',
        content: rawContent
      });
    }

    console.log(`Tìm thấy đơn hàng thanh toán SePay: #${matchedOrderCode} - Số tiền: ${amount}đ`);

    // 2. Lưu trạng thái Đã Thanh Toán vào Storage để Web khách hàng tự động nhảy thành công
    let storeData = null;
    try {
      const storeRes = await fetch(STORAGE_URL, { cache: 'no-store' });
      if (storeRes.ok) {
        storeData = await storeRes.json();
      }
    } catch (e) {}

    if (!storeData || !storeData.data) {
      storeData = { name: 'baco_subscriptions', data: { subs: [], paidOrders: [] } };
    }

    let paidOrders = storeData.data.paidOrders || [];
    const existingIdx = paidOrders.findIndex(p => String(p.orderCode).toUpperCase() === matchedOrderCode);
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

    const putRes = await fetch(STORAGE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'baco_subscriptions',
        data: storeData.data
      })
    });
    console.log('Cập nhật Storage SePay thành công:', putRes.status);

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
      amount: amount
    });

  } catch(error) {
    console.error('Lỗi SePay Webhook:', error);
    return res.status(500).json({ error: error.message });
  }
};
