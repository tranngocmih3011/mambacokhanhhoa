// api/check-payment-status.js
// Endpoint kiểm tra trạng thái thanh toán đơn hàng chuẩn theo tài liệu SePay
// (https://sepay.vn/lap-trinh-cong-thanh-toan.html - Mục 2.2.3)

const STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a15e3ab16c3de8';
const SHEET_ID = '1ZvX_-wHeoc6fcv43hW_Jj-blOagtsFJiazorJJ8pBBw';

const STORAGE_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

function isOrderCodeMatch(paidCode, queryCode) {
  if (!paidCode || !queryCode) return false;
  const p = String(paidCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const q = String(queryCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!p || !q) return false;

  // 1. Khớp tuyệt đối (BC292087 === BC292087)
  if (p === q) return true;

  // 2. Chứa nhau (BC292087 trong SEVQRBC292087)
  if (p.includes(q) || q.includes(p)) return true;

  // 3. Khớp chuỗi số (292087)
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // 1. Kiểm tra trong bộ nhớ giao dịch SePay
    let match = null;
    try {
      const storeRes = await fetch(STORAGE_URL, { headers: STORAGE_HEADERS });
      if (storeRes.ok) {
        const storeData = await storeRes.json();
        const paidOrders = (storeData && storeData.data && storeData.data.paidOrders) || [];

        // Khớp theo mã đơn
        match = paidOrders.find(p => isOrderCodeMatch(p.orderCode, cleanOrder));

        // Khớp dự phòng theo số tiền nếu giao dịch trong 30 phút gần nhất
        if (!match && amount > 0) {
          match = paidOrders.find(p => {
            if (Math.abs(Number(p.amount) - amount) < 100) {
              const diffMinutes = (Date.now() - new Date(p.paidAt).getTime()) / 60000;
              return diffMinutes >= 0 && diffMinutes <= 30;
            }
            return false;
          });
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc storage:', e.message);
    }

    // 2. Nếu tìm thấy giao dịch đã thanh toán
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

    // 3. Fallback: Kiểm tra trực tiếp trên Google Sheet nếu lưu trữ chưa kịp cập nhật
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
      const gRes = await fetch(gvizUrl, { headers: STORAGE_HEADERS });
      if (gRes.ok) {
        const gText = await gRes.text();
        const jsonMatch = gText.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
        if (jsonMatch && jsonMatch[1]) {
          const gData = JSON.parse(jsonMatch[1]);
          const rows = (gData.table && gData.table.rows) || [];
          for (const r of rows) {
            const cells = (r && r.c) || [];
            const rCode = cells[2] && cells[2].v ? String(cells[2].v) : '';
            const rStatus = cells[11] && cells[11].v ? String(cells[11].v) : '';
            if (isOrderCodeMatch(rCode, cleanOrder) && rStatus.toLowerCase().includes('đã nhận tiền')) {
              return res.status(200).json({
                payment_status: 'Paid',
                paid: true,
                order_id: cleanOrder,
                orderCode: cleanOrder,
                source: 'google_sheet'
              });
            }
          }
        }
      }
    } catch (e) {}

    // Chưa thanh toán
    return res.status(200).json({
      payment_status: 'Unpaid',
      paid: false,
      order_id: cleanOrder
    });

  } catch (error) {
    return res.status(500).json({ payment_status: 'Error', error: error.message });
  }
};
