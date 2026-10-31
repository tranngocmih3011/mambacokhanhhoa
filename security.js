/**
 * BACO KHANH HOA - SECURITY & COMPATIBILITY MODULE
 * Tối ưu trải nghiệm mua sắm: Khách hàng được tự do sao chép thông tin liên hệ, hotline, địa chỉ
 * Chỉ áp dụng bảo vệ chuyên sâu cho trang quản trị nội bộ.
 */
(function() {
    'use strict';

    const isAdminPage = window.location.pathname.includes('admin') || window.location.href.includes('admin');

    // Nếu không phải trang admin (khách đang mua sắm trên index hoặc products):
    // Cho phép khách tự do click chuột phải, copy SĐT, địa chỉ để tra cứu thuận tiện nhất.
    if (!isAdminPage) {
        return;
    }

    // 1. Chỉ áp dụng chặn chuột phải trên trang Admin
    document.addEventListener('contextmenu', function(e) {
        // Cho phép nhập liệu trong input/textarea của admin
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        return false;
    }, true);

    // 2. Chặn các phím tắt mở DevTools trên Admin
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 123 || e.key === 'F12') {
            e.preventDefault();
            return false;
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

        // Ctrl/Cmd + Shift + I / J / C
        if (ctrlOrCmd && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.key === 'I' || e.key === 'J' || e.key === 'C')) {
            e.preventDefault();
            return false;
        }

        // Ctrl/Cmd + U (View Source)
        if (ctrlOrCmd && (e.keyCode === 85 || e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            return false;
        }
    }, true);
})();
