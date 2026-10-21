/**
 * BACO KHANH HOA - CLIENT-SIDE SECURITY SHIELD & ANTI-INSPECT MODULE
 * Chặn F12, phím tắt kiểm tra, chuột phải và phát hiện DevTools
 */
(function() {
    'use strict';

    // 1. Tắt hoàn toàn chuột phải (Context Menu)
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showSecurityAlert('Tính năng nhấp chuột phải đã bị khóa để bảo vệ bản quyền.');
        return false;
    }, true);

    // 2. Chặn các phím tắt mở DevTools, xem mã nguồn, lưu trang
    document.addEventListener('keydown', function(e) {
        // F12
        if (e.keyCode === 123 || e.key === 'F12') {
            e.preventDefault();
            e.stopPropagation();
            showSecurityAlert('Phím tắt F12 (Inspect) đã bị khóa.');
            return false;
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

        // Ctrl/Cmd + Shift + I (Inspect)
        // Ctrl/Cmd + Shift + J (Console)
        // Ctrl/Cmd + Shift + C (Element Selector)
        if (ctrlOrCmd && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.key === 'I' || e.key === 'J' || e.key === 'C')) {
            e.preventDefault();
            e.stopPropagation();
            showSecurityAlert('Công cụ kiểm tra phần tử đã bị khóa.');
            return false;
        }

        // Ctrl/Cmd + U (View Source)
        if (ctrlOrCmd && (e.keyCode === 85 || e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            e.stopPropagation();
            showSecurityAlert('Tính năng xem mã nguồn (View Source) đã bị khóa.');
            return false;
        }

        // Ctrl/Cmd + S (Save Page)
        if (ctrlOrCmd && (e.keyCode === 83 || e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    // 3. Chặn kéo thả hình ảnh
    document.addEventListener('dragstart', function(e) {
        if (e.target && e.target.nodeName === 'IMG') {
            e.preventDefault();
            return false;
        }
    }, true);

    // 4. Vô hiệu hóa và xóa toàn bộ log Console để không lộ URL / dữ liệu
    try {
        const noop = function() {};
        window.console.log = noop;
        window.console.warn = noop;
        window.console.info = noop;
        window.console.debug = noop;
    } catch(err) {}

    // 5. Cảnh báo hiển thị nhanh dạng Toast thông minh
    let alertTimer = null;
    function showSecurityAlert(msg) {
        let el = document.getElementById('bacoSecurityWarningToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'bacoSecurityWarningToast';
            el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.95);color:#fef08a;padding:10px 20px;border-radius:9999px;font-size:12px;font-weight:700;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);border:1px solid rgba(251,191,36,0.4);z-index:999999;transition:all 0.3s ease;pointer-events:none;display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px);font-family:system-ui,-apple-system,sans-serif;';
            document.body.appendChild(el);
        }
        el.innerHTML = '<span>🛡️</span><span>' + msg + '</span>';
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(alertTimer);
        alertTimer = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) translateY(10px)';
        }, 2200);
    }

    // 6. Xóa và bảo vệ Console sạch sẽ
    setInterval(function() {
        try {
            if (window.console) {
                window.console.clear();
            }
        } catch(e) {}
    }, 2000);
})();
