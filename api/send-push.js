// api/send-push.js - Gửi Web Push Notification tới thiết bị qua Apple APNs / FCM / Mozilla Push Service
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BNIqo8uK0d1Fm-43McRzIOp5W0lfQv8XKbWt74wIlDyGwWEOfhct4kDcWyuasywGlAgKR4ft_ZamSMiV90Nbsr8';
const VAPID_PRIVATE_KEY = 'KegP8AMJuN90ptkVt_tvdxi9P7uwXT0fnVPC8x52L-g';
const VAPID_SUBJECT = 'mailto:tranngocmih3011@gmail.com';

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec";

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
    const { title, body: msgBody, url, code, type, directSubscription } = body;

    const payload = JSON.stringify({
      title: title || '🛒 Đơn hàng mới - Nước Mắm Ba Cô',
      body: msgBody || 'Khách hàng vừa đặt hàng thành công!',
      url: url || './admin.html',
      code: code || '',
      type: type || 'orders',
      timestamp: Date.now()
    });

    let subscriptions = [];

    if (directSubscription && directSubscription.endpoint) {
      subscriptions = [directSubscription];
    } else {
      const gasRes = await fetch(`${GOOGLE_SCRIPT_URL}?action=get_push_subscriptions`);
      const gasData = await gasRes.json().catch(() => ({ subscriptions: [] }));
      subscriptions = gasData.subscriptions || [];
    }

    if (subscriptions.length === 0) {
      return res.status(200).json({ success: true, sent: 0, message: 'No registered push subscriptions yet.' });
    }

    const results = await Promise.allSettled(
      subscriptions.map(sub => 
        webpush.sendNotification(sub, payload, {
          TTL: 86400,
          urgency: 'high'
        })
      )
    );

    let sentCount = 0;
    const expiredEndpoints = [];

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        sentCount++;
      } else {
        console.warn(`Failed push to subscription ${idx}:`, r.reason);
        if (r.reason && (r.reason.statusCode === 410 || r.reason.statusCode === 404)) {
          expiredEndpoints.push(subscriptions[idx].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_expired_push_subscriptions',
          endpoints: expiredEndpoints
        })
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      sent: sentCount,
      total: subscriptions.length
    });

  } catch (error) {
    console.error('Error sending web push:', error);
    return res.status(500).json({ error: error.message });
  }
};
