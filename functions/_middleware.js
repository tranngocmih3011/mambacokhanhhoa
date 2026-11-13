// functions/_middleware.js — Cloudflare Pages Function (chạy trước MỌI route)
// =====================================================================
//  HỆ THỐNG BẢO VỆ BIÊN — BA CÔ KHÁNH HÒA (ZERO-CONFIG EDGE SHIELD)
//  1. Chặn truy cập file nội bộ / mã nguồn backend (.js server, .txt, .json cấu hình, .git, .env...)
//  2. Chặn bot quét lỗ hổng (wp-admin, phpmyadmin, xmlrpc, .env ...) & User-Agent công cụ tấn công
//  3. Chống DDoS Layer 7 & spam: giới hạn tần suất theo IP + chặn payload quá lớn + chặn URI độc hại
//  4. Khóa cross-origin / spam cho API nội bộ (/api/send-push, /api/push-subscribe)
//  5. HTTP Security Headers tối đa (CSP bỏ unsafe-eval & Tailwind CDN, HSTS Preload, XFO DENY...)
//  * Đăng nhập quản trị được xác thực trực tiếp qua Google Sheet & Apps Script.
// =====================================================================

const MAX_BODY_BYTES = 65_536; // giới hạn payload 64KB chống HTTP body flood

// Giới hạn request / IP theo cửa sổ thời gian (kết hợp WAF Cloudflare Rate Limiting ở biên)
const RATE_LIMITS = {
  api:  { windowMs: 10_000, max: 25 },
  push: { windowMs: 60_000, max: 8 },
  page: { windowMs: 10_000, max: 90 },
};

// ---------- Danh sách chặn ----------
const BLOCKED_EXACT = new Set([
  '/googleappsscript.js', '/chime_datauri.txt', '/vercel.json', '/package.json',
  '/package-lock.json', '/.gitignore', '/wrangler.toml', '/_headers', '/_redirects',
  '/_routes.json',
]);
const BLOCKED_PREFIX = ['/.git', '/.env', '/.ds_store', '/functions/', '/node_modules/', '/api/', '/pictrure/.ds_store'];
const SCANNER_PATTERNS = /(wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|\.php$|\.asp|\.aspx$|\.jsp$|cgi-bin|\/etc\/passwd|\.\.\/|%2e%2e|\.sql$|\.bak$|\.old$|\.swp$|\.ini$|\.log$|\/vendor\/|\/actuator|\/server-status|\/\.well-known\/security\.txt\.bak)/i;
const BAD_UA = /(sqlmap|nikto|nmap|masscan|zgrab|acunetix|nessus|wpscan|dirbuster|gobuster|ffuf|feroxbuster|nuclei|httrack|python-requests\/[01]\.|go-http-client\/1\.1$|libwww-perl|scrapy|havij|jorgee|fuzz|curl\/[0-6]\.|wget)/i;

// ---------- Bộ đếm trong bộ nhớ (theo isolate) ----------
const memBuckets = new Map();
function memRateLimited(key, limitCfg) {
  const now = Date.now();
  let b = memBuckets.get(key);
  if (!b || now - b.start > limitCfg.windowMs) {
    b = { start: now, count: 0 };
    memBuckets.set(key, b);
  }
  b.count++;
  if (memBuckets.size > 5000) {
    for (const [k, v] of memBuckets) if (now - v.start > 60_000) memBuckets.delete(k);
  }
  return b.count > limitCfg.max;
}

// ---------- Security headers (không còn cdn.tailwindcss.com) ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://docs.google.com https://script.google.com https://script.googleusercontent.com https://mambacokhanhhoa.vercel.app https://qr.sepay.vn https://api.restful-api.dev https://provinces.open-api.vn https://cdn.jsdelivr.net https://cloudflareinsights.com",
  "media-src 'self' data: blob:",
  "frame-src https://www.google.com https://maps.google.com https://www.youtube.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://script.google.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

function applySecurityHeaders(headers) {
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('Content-Security-Policy', CSP);
  headers.delete('X-Powered-By');
  headers.delete('Server');
}

function deny(status = 404, text = 'Not Found', extra = {}) {
  const h = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extra,
  });
  applySecurityHeaders(h);
  return new Response(text, { status, headers: h });
}

function isSameOriginRequest(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === url.origin; } catch (e) { return false; }
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return fetchSite === 'same-origin';
}

function isAdminPath(path) {
  return path === '/admin' || path === '/admin.html' || path === '/admin/' || path.startsWith('/admin/');
}

// =====================================================================
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  let rawPath;
  try {
    rawPath = decodeURIComponent(url.pathname);
  } catch (e) {
    return deny(400, 'Bad Request');
  }
  const path = rawPath.replace(/\/+/g, '/').replace(/\/\.\//g, '/').toLowerCase();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || '';
  const method = request.method.toUpperCase();

  // 1. Chỉ cho phép các phương thức HTTP hợp lệ
  if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(method)) {
    return deny(405, 'Method Not Allowed', { Allow: 'GET, HEAD, POST, OPTIONS' });
  }

  // 2. Chặn công cụ tấn công, URI quá dài & bot quét lỗ hổng
  const isApi = path.startsWith('/api/') || path.includes('webhook');
  if (BAD_UA.test(ua) || (!isApi && (!ua || ua.length < 8))) return deny(403, 'Forbidden');
  if (SCANNER_PATTERNS.test(path) || url.search.length > 2048 || path.length > 512) return deny(404);

  // 3. Chặn payload lớn quá mức (anti HTTP body flood)
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) return deny(413, 'Payload Too Large');

  // 4. Chặn tải file nội bộ / backend
  if (BLOCKED_EXACT.has(path)) return deny(404);
  if (BLOCKED_PREFIX.some(p => path.startsWith(p))) {
    if (!(path.startsWith('/api/') && !path.endsWith('.js'))) return deny(404);
  }

  // 5. Rate limit chống DDoS Layer 7 / spam
  let bucket = 'page';
  if (path === '/api/send-push' && method === 'POST') bucket = 'push';
  else if (isApi) bucket = 'api';

  if (memRateLimited(bucket + ':' + ip, RATE_LIMITS[bucket])) {
    return deny(429, 'Too Many Requests — vui lòng thử lại sau ít giây.', { 'Retry-After': '15' });
  }

  // 6. Bảo vệ các endpoint API nội bộ nhạy cảm (chỉ cho phép gọi từ chính website)
  if ((path === '/api/send-push' || path === '/api/push-subscribe') && method === 'POST') {
    if (!isSameOriginRequest(request, url)) return deny(403, 'Forbidden');
  }

  // 7. Phục vụ nội dung + gắn security headers
  const response = await next();
  const res = new Response(response.body, response);
  applySecurityHeaders(res.headers);
  if (isAdminPath(path) || isApi) {
    res.headers.set('Cache-Control', 'no-store, private');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}
