// functions/_middleware.js — Cloudflare Pages Function (chạy trước MỌI route động/nhạy cảm)
// =====================================================================
//  HỆ THỐNG BẢO MẬT CAO NHẤT — BA CÔ KHÁNH HÒA
//  1. Chặn truy cập file nội bộ / mã nguồn backend (.js server, .txt, .json cấu hình, .git, .env...)
//  2. Chặn bot quét lỗ hổng (wp-admin, phpmyadmin, xmlrpc, .env ...) & User-Agent công cụ tấn công
//  3. Chống DDoS Layer 7 & spam: giới hạn tần suất theo IP + chặn payload quá lớn + chặn URI độc hại
//  4. Bảo vệ API nội bộ (/api/push-subscribe, debug webhook) bằng phiên Admin HMAC
//     và khóa cross-origin / spam cho /api/send-push
//  5. Xác thực trang quản trị PHÍA MÁY CHỦ + Chống Brute-Force (khóa IP tăng dần tới 24h)
//  6. HTTP Security Headers tối đa (CSP bỏ unsafe-eval & bỏ Tailwind CDN, HSTS Preload, XFO DENY...)
//
//  BIẾN MÔI TRƯỜNG (Cloudflare Dashboard → Pages → Settings → Variables and Secrets):
//    SESSION_SECRET    (bắt buộc, kiểu Secret) – chuỗi ngẫu nhiên ≥ 32 ký tự để ký phiên HMAC
//    SHEET_AUTH_SECRET (khuyến nghị, kiểu Secret) – khóa đồng bộ với Google Apps Script để xác thực qua tab QuanTriVien
//    ADMIN_PASSWORD    (tùy chọn/dự phòng, kiểu Secret) – mật khẩu quản trị dự phòng nếu không dùng hoặc gián đoạn Sheet
//  KV (khuyến nghị, để chống brute-force bền vững toàn cầu):
//    Bindings → KV namespace → tên biến: SECURITY_KV
// =====================================================================

const SESSION_COOKIE = '__Host-baco_admin';
const SESSION_TTL_SEC = 7 * 24 * 3600;          // phiên quản trị 7 ngày
const LOGIN_MAX_FAILS = 5;                       // sai 5 lần -> khóa
const LOGIN_LOCK_BASE_SEC = 15 * 60;             // khóa 15 phút, nhân đôi mỗi lần tái phạm (tối đa 24h)
const LOGIN_FAIL_WINDOW_SEC = 30 * 60;
const MAX_BODY_BYTES = 65_536;                   // giới hạn payload 64KB chống HTTP body flood

// Giới hạn request / IP theo cửa sổ thời gian (mỗi isolate; kết hợp WAF Cloudflare Rate Limiting ở biên)
const RATE_LIMITS = {
  api:   { windowMs: 10_000, max: 25 },
  push:  { windowMs: 60_000, max: 8 },
  auth:  { windowMs: 60_000, max: 12 },
  page:  { windowMs: 10_000, max: 90 },
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
const memLogin = new Map(); // fallback khi chưa gắn KV

// ---------- Security headers (không còn cdn.tailwindcss.com) ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://docs.google.com https://script.google.com https://script.googleusercontent.com https://mambacokhanhhoa.vercel.app https://qr.sepay.vn https://api.restful-api.dev https://cdn.jsdelivr.net https://cloudflareinsights.com",
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

const DEFAULT_GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwxsz6e-XXYaNO3LihXxlHIzYkYqZsnaBiIke58PxN4FJA62FR_a2evQBxCgihxasbQiw/exec';

// ---------- Crypto & Encoding helpers ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
function toB64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return dec.decode(arr);
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toB64Url(new Uint8Array(sig));
}
function timingSafeEqual(a, b) {
  const ab = enc.encode(String(a)), bb = enc.encode(String(b));
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
async function passwordMatches(input, expected, secret) {
  const [x, y] = await Promise.all([hmac(secret, 'pw:' + input), hmac(secret, 'pw:' + expected)]);
  return timingSafeEqual(x, y);
}
function getSigningSecret(env) {
  return `${env.SESSION_SECRET || ''}|${env.SHEET_AUTH_SECRET || ''}|${env.ADMIN_PASSWORD || ''}`;
}
function isAuthConfigured(env) {
  return !!(env.SESSION_SECRET && (env.SHEET_AUTH_SECRET || env.ADMIN_PASSWORD));
}

async function createSession(env, userInfo = {}) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const nonce = crypto.randomUUID();
  const uname = toB64Url(enc.encode(String(userInfo.username || 'admin').slice(0, 64)));
  const urole = toB64Url(enc.encode(String(userInfo.role || 'Quản trị viên').slice(0, 64)));
  const payload = `v2.${exp}.${uname}.${urole}.${nonce}`;
  const sig = await hmac(getSigningSecret(env), payload);
  return `${payload}.${sig}`;
}
async function verifySession(env, token) {
  if (!token || !isAuthConfigured(env)) return null;
  const parts = token.split('.');
  if (parts[0] === 'v2' && parts.length === 6) {
    const exp = Number(parts[1]);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
    const expected = await hmac(getSigningSecret(env), parts.slice(0, 5).join('.'));
    if (!timingSafeEqual(expected, parts[5])) return null;
    try {
      return { valid: true, username: fromB64Url(parts[2]) || 'admin', role: fromB64Url(parts[3]) || 'Quản trị viên' };
    } catch (e) {
      return { valid: true, username: 'admin', role: 'Quản trị viên' };
    }
  }
  // Tương thích ngược với cookie v1 nếu có ADMIN_PASSWORD
  if (parts[0] === 'v1' && parts.length === 4 && env.ADMIN_PASSWORD) {
    const exp = Number(parts[1]);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
    const expected = await hmac(env.SESSION_SECRET + '|' + env.ADMIN_PASSWORD, parts.slice(0, 3).join('.'));
    return timingSafeEqual(expected, parts[3]) ? { valid: true, username: 'admin', role: 'Quản trị viên' } : null;
  }
  return null;
}
function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) {
      try { return decodeURIComponent(part.slice(i + 1)); } catch (e) { return ''; }
    }
  }
  return '';
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

// ---------- Chống brute-force ----------
async function getLoginState(env, ip) {
  const key = 'login:' + ip;
  if (env.SECURITY_KV) {
    try { return JSON.parse((await env.SECURITY_KV.get(key)) || 'null') || { fails: 0, strikes: 0, lockUntil: 0, first: 0 }; } catch (e) {}
  }
  return memLogin.get(key) || { fails: 0, strikes: 0, lockUntil: 0, first: 0 };
}
async function saveLoginState(env, ip, st) {
  const key = 'login:' + ip;
  if (env.SECURITY_KV) {
    try { await env.SECURITY_KV.put(key, JSON.stringify(st), { expirationTtl: 86400 * 2 }); return; } catch (e) {}
  }
  memLogin.set(key, st);
}

// ---------- Truy vấn xác thực qua Google Sheet (Apps Script Server-to-Server) ----------
async function verifyAdminViaSheet(env, username, password, ip, ua) {
  const scriptUrl = env.GOOGLE_SCRIPT_URL || DEFAULT_GOOGLE_SCRIPT_URL;
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify_admin',
        authKey: env.SHEET_AUTH_SECRET,
        username: String(username || 'admin').trim().toLowerCase(),
        password: String(password || ''),
        ip: String(ip || ''),
        userAgent: String(ua || '').slice(0, 180),
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, serviceError: true };
    const data = await res.json();
    if (!data || data.status !== 'success') {
      return { ok: false, serviceError: true };
    }
    if (data.valid === true) {
      return { ok: true, username: String(data.username || username), role: String(data.role || 'Quản trị viên') };
    }
    return { ok: false, serviceError: false, reason: String(data.reason || '') };
  } catch (e) {
    return { ok: false, serviceError: true };
  }
}

// ---------- Trang đăng nhập (không chứa mã nguồn quản trị) ----------
function loginPage(message = '', status = 200, lockSeconds = 0, usernameValue = 'admin') {
  const msg = message ? `<div class="err">${escHtml(message)}</div>` : '';
  const safeUser = escHtml(usernameValue || 'admin');
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>Đăng nhập quản trị • Ba Cô Khánh Hòa</title>
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#f2f2f7">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Arial,sans-serif;padding:20px;color:#1c1c1e}
.card{width:100%;max-width:360px;background:#fff;border-radius:22px;padding:28px 22px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
.logo{width:64px;height:64px;border-radius:50%;object-fit:cover;display:block;margin:0 auto 12px;box-shadow:0 0 0 3px rgba(0,122,255,.25)}
h1{font-size:18px;text-align:center;margin:0}p.sub{font-size:12px;color:#8E8E93;text-align:center;margin:4px 0 18px}
.field{margin-bottom:12px}
label{display:block;font-size:12px;color:#8E8E93;font-weight:500}
input{width:100%;margin-top:6px;padding:12px 14px;border:0;border-radius:12px;background:rgba(118,118,128,.12);font-size:15px;outline:none}
input:focus{background:#fff;box-shadow:0 0 0 2px #007AFF}
button{width:100%;margin-top:8px;padding:13px;border:0;border-radius:12px;background:#007AFF;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
.err{font-size:12px;color:#FF3B30;background:rgba(255,59,48,.1);padding:10px;border-radius:12px;text-align:center;margin-bottom:12px;line-height:1.45}
.foot{font-size:11px;color:#8E8E93;text-align:center;margin-top:16px;line-height:1.5}
</style></head><body>
<form class="card" method="POST" action="/__auth/login" autocomplete="on">
<img class="logo" src="/pictrure/logo.JPG" alt="Ba Cô">
<h1>Ba Cô Khánh Hòa</h1><p class="sub">Khu vực quản trị được bảo vệ</p>
${msg}
<div class="field"><label for="un">Tên đăng nhập</label>
<input id="un" name="username" type="text" value="${safeUser}" autocomplete="username" required maxlength="64" ${lockSeconds ? 'disabled' : ''}></div>
<div class="field"><label for="pw">Mật khẩu quản trị</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required minlength="4" maxlength="128" autofocus ${lockSeconds ? 'disabled' : ''}></div>
<button type="submit" ${lockSeconds ? 'disabled' : ''}>Đăng nhập</button>
<div class="foot">🔒 Xác thực máy chủ qua Google Sheet &amp; HMAC • Tự động khóa IP khi dò sai</div>
</form></body></html>`;
  const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  applySecurityHeaders(h);
  return new Response(html, { status, headers: h });
}

function isAdminPath(path) {
  return path === '/admin' || path === '/admin.html' || path === '/admin/' || path.startsWith('/admin/');
}

async function handleLogin(context, ip) {
  const { request, env } = context;
  if (!isAuthConfigured(env)) {
    return loginPage('⚠️ Máy chủ chưa cấu hình SESSION_SECRET và SHEET_AUTH_SECRET (hoặc ADMIN_PASSWORD) trong Cloudflare Pages → Settings → Variables and Secrets.', 503);
  }
  if (request.method !== 'POST') return Response.redirect(new URL('/admin.html', request.url).toString(), 303);

  // Chống CSRF: chỉ chấp nhận form gửi từ chính website
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return deny(403, 'Forbidden');

  const now = Math.floor(Date.now() / 1000);
  const st = await getLoginState(env, ip);
  if (st.lockUntil > now) {
    const mins = Math.ceil((st.lockUntil - now) / 60);
    return loginPage(`⛔ IP của bạn đã bị tạm khóa do nhập sai quá nhiều lần. Thử lại sau ${mins} phút.`, 429, st.lockUntil - now);
  }

  let username = 'admin';
  let password = '';
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      username = String(body.username || 'admin');
      password = String(body.password || '');
    } else {
      const fd = await request.formData();
      username = String(fd.get('username') || 'admin');
      password = String(fd.get('password') || '');
    }
  } catch (e) {}
  username = username.trim().toLowerCase().slice(0, 64) || 'admin';
  password = password.slice(0, 128);

  // Làm chậm cố định để vô hiệu hóa dò mật khẩu tốc độ cao
  await new Promise(r => setTimeout(r, 450 + Math.floor(Math.random() * 300)));

  let verifiedUser = null;
  if (password) {
    if (env.SHEET_AUTH_SECRET) {
      const ua = request.headers.get('User-Agent') || '';
      const sheetRes = await verifyAdminViaSheet(env, username, password, ip, ua);
      if (sheetRes.ok) {
        verifiedUser = { username: sheetRes.username, role: sheetRes.role };
      } else if (sheetRes.serviceError && env.ADMIN_PASSWORD && username === 'admin') {
        // Dự phòng khẩn cấp khi Google Sheet / Apps Script tạm gián đoạn
        if (await passwordMatches(password, env.ADMIN_PASSWORD, env.SESSION_SECRET)) {
          verifiedUser = { username: 'admin', role: 'Quản trị viên (Fallback)' };
        }
      }
    } else if (env.ADMIN_PASSWORD && username === 'admin') {
      if (await passwordMatches(password, env.ADMIN_PASSWORD, env.SESSION_SECRET)) {
        verifiedUser = { username: 'admin', role: 'Quản trị viên' };
      }
    }
  }

  if (verifiedUser) {
    await saveLoginState(env, ip, { fails: 0, strikes: st.strikes > 0 ? st.strikes - 1 : 0, lockUntil: 0, first: 0 });
    const token = await createSession(env, verifiedUser);
    const h = new Headers({
      'Location': '/admin.html',
      'Cache-Control': 'no-store',
      'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SEC}; HttpOnly; Secure; SameSite=Strict`,
    });
    applySecurityHeaders(h);
    return new Response(null, { status: 303, headers: h });
  }

  // Sai tài khoản hoặc mật khẩu
  if (!st.first || now - st.first > LOGIN_FAIL_WINDOW_SEC) { st.first = now; st.fails = 0; }
  st.fails++;
  let msg = `Tên đăng nhập hoặc mật khẩu không chính xác. Còn ${Math.max(0, LOGIN_MAX_FAILS - st.fails)} lần thử trước khi bị khóa.`;
  let status = 401;
  if (st.fails >= LOGIN_MAX_FAILS) {
    const lockSec = Math.min(86400, LOGIN_LOCK_BASE_SEC * Math.pow(2, st.strikes || 0));
    st.lockUntil = now + lockSec;
    st.strikes = (st.strikes || 0) + 1;
    st.fails = 0; st.first = 0;
    msg = `⛔ Sai quá ${LOGIN_MAX_FAILS} lần. IP đã bị khóa ${Math.round(lockSec / 60)} phút.`;
    status = 429;
  }
  await saveLoginState(env, ip, st);
  return loginPage(msg, status, status === 429 ? 1 : 0, username);
}

function handleLogout() {
  const h = new Headers({
    'Location': '/admin.html',
    'Cache-Control': 'no-store',
    'Clear-Site-Data': '"cookies"',
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  });
  applySecurityHeaders(h);
  return new Response(null, { status: 303, headers: h });
}

// =====================================================================
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  let rawPath;
  try {
    rawPath = decodeURIComponent(url.pathname);
  } catch (e) {
    return deny(400, 'Bad Request');
  }
  // Chuẩn hóa đường dẫn để chặn các thủ thuật //admin.html, /./admin.html
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
  else if (path.startsWith('/__auth/')) bucket = 'auth';

  if (memRateLimited(bucket + ':' + ip, RATE_LIMITS[bucket])) {
    return deny(429, 'Too Many Requests — vui lòng thử lại sau ít giây.', { 'Retry-After': '15' });
  }

  // 6. Bảo vệ các endpoint API nội bộ nhạy cảm
  if (path === '/api/push-subscribe') {
    const ok = await verifySession(env, getCookie(request, SESSION_COOKIE));
    if (!ok) return deny(401, 'Unauthorized');
  }
  if ((path.startsWith('/api/sepay') || path.includes('sepay-webhook') || path.includes('sepay_webhook')) && method === 'GET' && url.searchParams.has('debug')) {
    const ok = await verifySession(env, getCookie(request, SESSION_COOKIE));
    if (!ok) return deny(403, 'Forbidden');
  }
  if (path === '/api/send-push' && method === 'POST') {
    // Chỉ chấp nhận request xuất phát từ chính website (chặn spam webhook/Telegram từ ngoài)
    if (!isSameOriginRequest(request, url)) return deny(403, 'Forbidden');
  }

  // 7. Xác thực quản trị phía máy chủ
  if (path === '/__auth/login') return handleLogin(context, ip);
  if (path === '/__auth/logout') return handleLogout();
  if (path === '/__auth/status') {
    const session = await verifySession(env, getCookie(request, SESSION_COOKIE));
    const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    applySecurityHeaders(h);
    return new Response(JSON.stringify({
      authenticated: !!(session && session.valid),
      username: session ? session.username : null,
      role: session ? session.role : null,
    }), { status: session ? 200 : 401, headers: h });
  }
  if (isAdminPath(path)) {
    const session = await verifySession(env, getCookie(request, SESSION_COOKIE));
    if (!session) {
      if (!isAuthConfigured(env)) {
        return loginPage('⚠️ Máy chủ chưa cấu hình SESSION_SECRET và SHEET_AUTH_SECRET (hoặc ADMIN_PASSWORD) trong Cloudflare Pages → Settings → Variables and Secrets.', 503);
      }
      return loginPage('', 401);
    }
  }

  // 8. Phục vụ nội dung + gắn security headers
  const response = await next();
  const res = new Response(response.body, response);
  applySecurityHeaders(res.headers);
  if (isAdminPath(path) || isApi) {
    res.headers.set('Cache-Control', 'no-store, private');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}
