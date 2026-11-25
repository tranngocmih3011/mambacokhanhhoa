// api/push-subscribe.js - Quản lý và lưu trữ thiết bị Push & cấu hình Telegram (Hardened)
const STORAGE_URL = process.env.SUBS_STORAGE_URL || '';
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';

const ALLOWED_ORIGINS = new Set([
  'https://mambacokhanhhoa.pages.dev',
  'https://mambacokhanhhoa.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mambacokhanhhoa.pages.dev';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!STORAGE_URL) {
    return res.status(503).json({ error: 'Storage not configured on server' });
  }

  // GET: Kiểm tra trạng thái thiết bị đã đăng ký
  if (req.method === 'GET') {
    try {
      const storeRes = await fetch(STORAGE_URL);
      const storeData = await storeRes.json();
      const subs = (storeData && storeData.data && storeData.data.subs) || [];
      const telegram = (storeData && storeData.data && storeData.data.telegram) || {};
      return res.status(200).json({
        success: true,
        devicesCount: subs.length,
        telegramConfigured: !!(telegram.botToken && telegram.chatId),
        lastUpdated: storeData.updatedAt || storeData.createdAt
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const action = body.action || 'save_subscription';

    // Xác thực sessionToken quản trị qua Google Apps Script cho thao tác nhạy cảm
    if (action === 'save_telegram' || action === 'save_subscription') {
      const sessionToken = String(body.sessionToken || '').trim();
      if (!sessionToken || !GOOGLE_SCRIPT_URL) {
        return res.status(401).json({ error: 'Unauthorized: Yêu cầu phiên đăng nhập quản trị hợp lệ' });
      }
      const verifyRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verify_session', token: sessionToken }),
        redirect: 'follow'
      });
      const verifyData = await verifyRes.json();
      if (!verifyData || verifyData.status !== 'success' || verifyData.valid !== true) {
        return res.status(401).json({ error: 'Unauthorized: Phiên quản trị không hợp lệ hoặc đã hết hạn' });
      }
    }

    // 1. Đọc dữ liệu hiện tại từ Storage
    let storeData = null;
    try {
      const storeRes = await fetch(STORAGE_URL);
      if (storeRes.ok) {
        storeData = await storeRes.json();
      }
    } catch (err) {
      console.warn('Lỗi đọc storage:', err);
    }

    if (!storeData || !storeData.data) {
      storeData = { name: 'baco_subscriptions', data: { subs: [], telegram: { botToken: '', chatId: '' } } };
    }

    let subs = storeData.data.subs || [];
    let telegram = storeData.data.telegram || { botToken: '', chatId: '' };

    // Nhánh A: Cấu hình Telegram Bot
    if (action === 'save_telegram') {
      const { botToken, chatId } = body;
      telegram = {
        botToken: (botToken || '').trim(),
        chatId: (chatId || '').trim()
      };
      storeData.data.telegram = telegram;

      await fetch(STORAGE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'baco_subscriptions',
          data: storeData.data
        })
      });

      return res.status(200).json({
        success: true,
        message: 'Cấu hình Telegram Bot thành công',
        telegramConfigured: !!(telegram.botToken && telegram.chatId)
      });
    }

    // Nhánh B: Lưu Push Subscription thiết bị (iPhone / Android / PC)
    const { subscription, userAgent } = body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Thiếu subscription endpoint' });
    }

    // Kiểm tra xem endpoint này đã có trong danh sách chưa
    const existingIdx = subs.findIndex(s => s.endpoint === subscription.endpoint);
    const subRecord = {
      ...subscription,
      userAgent: userAgent || req.headers['user-agent'] || '',
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      subs[existingIdx] = subRecord;
    } else {
      subs.push(subRecord);
    }

    // Giới hạn lưu tối đa 30 thiết bị gần nhất để tối ưu hiệu năng
    if (subs.length > 30) {
      subs = subs.slice(-30);
    }

    storeData.data.subs = subs;

    // Lưu vào Storage bền vững
    const saveRes = await fetch(STORAGE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'baco_subscriptions',
        data: storeData.data
      })
    });

    const savedResult = await saveRes.json();

    return res.status(200).json({
      success: true,
      registered: true,
      devicesCount: subs.length,
      endpoint: subscription.endpoint.slice(0, 35) + '...'
    });

  } catch (error) {
    console.error('Lỗi lưu push subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};
