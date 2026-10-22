// api/send-push.js - Gửi Web Push Notification (APNs/FCM) & Telegram Bot khi có đơn mới
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BNIqo8uK0d1Fm-43McRzIOp5W0lfQv8XKbWt74wIlDyGwWEOfhct4kDcWyuasywGlAgKR4ft_ZamSMiV90Nbsr8';
const VAPID_PRIVATE_KEY = 'KegP8AMJuN90ptkVt_tvdxi9P7uwXT0fnVPC8x52L-g';
const VAPID_SUBJECT = 'mailto:tranngocmih3011@gmail.com';

const STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a15e3ab16c3de8';

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { title, body: msgBody, url, code, type, directSubscription, delay } = body;

    // Nếu có tham số delay (ví dụ 5s để người dùng kịp bấm khóa màn hình điện thoại)
    if (delay && Number(delay) > 0) {
      const waitMs = Math.min(Math.max(Number(delay), 1), 15) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    const payload = JSON.stringify({
      title: title || '🛒 Đơn hàng mới - Nước Mắm Ba Cô',
      body: msgBody || 'Khách hàng vừa đặt hàng thành công!',
      url: url || './admin.html',
      code: code || '',
      type: type || 'orders',
      timestamp: Date.now()
    });

    // 1. Lấy danh sách thiết bị và cấu hình Telegram từ Storage
    let subscriptions = [];
    let telegramConfig = { botToken: '', chatId: '' };

    try {
      const storeRes = await fetch(STORAGE_URL);
      if (storeRes.ok) {
        const storeData = await storeRes.json();
        if (storeData && storeData.data) {
          subscriptions = storeData.data.subs || [];
          telegramConfig = storeData.data.telegram || { botToken: '', chatId: '' };
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc subscription từ storage:', e);
    }

    // Nếu có directSubscription gửi kèm từ trình duyệt
    if (directSubscription && directSubscription.endpoint) {
      if (!subscriptions.some(s => s.endpoint === directSubscription.endpoint)) {
        subscriptions.push(directSubscription);
      }
    }

    // 2. Gửi Web Push tới tất cả thiết bị đã đăng ký (iPhone màn hình khóa, Android, PC)
    let sentCount = 0;
    const expiredEndpoints = [];

    if (subscriptions.length > 0) {
      const results = await Promise.allSettled(
        subscriptions.map(sub => 
          webpush.sendNotification(sub, payload, {
            TTL: 86400,
            urgency: 'high'
          })
        )
      );

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          sentCount++;
        } else {
          console.warn(`Thất bại push tới thiết bị ${idx}:`, r.reason);
          if (r.reason && (r.reason.statusCode === 410 || r.reason.statusCode === 404)) {
            expiredEndpoints.push(subscriptions[idx].endpoint);
          }
        }
      });

      // Nếu có thiết bị đã hủy quyền / hết hạn token, tự động xóa khỏi storage
      if (expiredEndpoints.length > 0) {
        const cleanedSubs = subscriptions.filter(s => !expiredEndpoints.includes(s.endpoint));
        fetch(STORAGE_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'baco_subscriptions',
            data: { subs: cleanedSubs, telegram: telegramConfig }
          })
        }).catch(() => {});
      }
    }

    // 3. Gửi Thông Báo Tức Thì Về Telegram Bot (Nếu đã cấu hình)
    let telegramSent = false;
    if (telegramConfig.botToken && telegramConfig.chatId) {
      try {
        const tgText = `🔔 <b>THÔNG BÁO TỰ ĐỘNG - NƯỚC MẮM BA CÔ</b>\n\n` +
                       `📌 <b>${title || 'Có Đơn Hàng Mới'}</b>\n` +
                       `💬 ${msgBody || 'Vui lòng kiểm tra trang quản trị!'}\n\n` +
                       `🔗 Mã tra cứu: <code>#${code || 'MỚI'}</code>\n` +
                       `⏰ Thời gian: ${new Date().toLocaleString('vi-VN')}\n` +
                       `👉 <a href="https://mambacokhanhhoa.vercel.app/admin.html?viewNotif=${encodeURIComponent(code || '')}">Nhấn vào đây để xem chi tiết đơn hàng</a>`;

        const tgRes = await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramConfig.chatId,
            text: tgText,
            parse_mode: 'HTML'
          })
        });
        const tgData = await tgRes.json();
        telegramSent = tgData && tgData.ok === true;
      } catch (tgErr) {
        console.warn('Lỗi gửi Telegram Bot:', tgErr);
      }
    }

    return res.status(200).json({
      success: true,
      sent: sentCount,
      total: subscriptions.length,
      telegramSent: telegramSent,
      message: sentCount > 0 ? `Đã gửi push tới ${sentCount} thiết bị` : 'Không có thiết bị push nào được đăng ký'
    });

  } catch (error) {
    console.error('Lỗi send-push:', error);
    return res.status(500).json({ error: error.message });
  }
};
