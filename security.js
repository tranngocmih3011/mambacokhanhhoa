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

    // 6. Tấm chắn toàn màn hình khi phát hiện DevTools được mở
    let shieldModal = null;
    function showDevToolsShield() {
        if (!shieldModal) {
            shieldModal = document.createElement('div');
            shieldModal.id = 'bacoDevToolsShield';
            shieldModal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:white;text-align:center;';
            shieldModal.innerHTML = `
                <div style="max-width:440px;background:rgba(15,23,42,0.95);border:1px solid rgba(251,191,36,0.3);padding:32px 24px;border-radius:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);line-height:1.6;">
                    <div style="font-size:48px;margin-bottom:12px;">🛡️</div>
                    <h2 style="font-size:20px;font-weight:800;color:#fef08a;margin-bottom:8px;letter-spacing:-0.5px;">BẢO MẬT HỆ THỐNG BA CÔ</h2>
                    <p style="font-size:13px;color:#cbd5e1;margin-bottom:16px;">Công cụ kiểm tra mã nguồn (DevTools) đã được kích hoạt. Vì lý do bảo mật bản quyền và dữ liệu, nội dung trang web tạm thời được ẩn đi.</p>
                    <div style="display:inline-block;background:rgba(251,191,36,0.1);color:#fde047;border:1px solid rgba(251,191,36,0.3);padding:8px 16px;border-radius:12px;font-size:12px;font-weight:700;">
                        Vui lòng đóng cửa sổ F12 để tiếp tục xem trang
                    </div>
                </div>
            `;
            document.body.appendChild(shieldModal);
        }
        shieldModal.style.display = 'flex';
        try { window.console.clear(); } catch(e) {}
    }

    function hideDevToolsShield() {
        if (shieldModal) {
            shieldModal.style.display = 'none';
        }
    }

    // 7. Thuật toán phát hiện DevTools liên tục
    let isDevToolsOpen = false;
    function checkDevTools() {
        // Kiểm tra qua độ chênh lệch kích thước khung cửa sổ
        const threshold = 160;
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;

        // Kiểm tra qua thời gian thực thi debugger
        const startTime = performance.now();
        (function() { return false; }['constructor']('debugger')());
        const endTime = performance.now();
        const debuggerTriggered = (endTime - startTime) > 100;

        if (widthThreshold || heightThreshold || debuggerTriggered) {
            if (!isDevToolsOpen) {
                isDevToolsOpen = true;
                showDevToolsShield();
            }
        } else {
            if (isDevToolsOpen) {
                isDevToolsOpen = false;
                hideDevToolsShield();
            }
        }
    }

    // Kiểm tra liên tục mỗi 600ms
    setInterval(checkDevTools, 600);
})();
