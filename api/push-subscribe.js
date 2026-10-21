// api/push-subscribe.js - Lưu Push Subscription vào Google Sheet
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec";

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
    const { subscription, userAgent } = body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Missing subscription endpoint' });
    }

    // Gửi lưu vào Google Sheet qua Google Apps Script
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_push_subscription',
        subscription: subscription,
        userAgent: userAgent || req.headers['user-agent'] || '',
        timestamp: new Date().toLocaleString('vi-VN')
      })
    });

    const data = await response.json().catch(() => ({ status: 'success' }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return res.status(500).json({ error: error.message });
  }
};
