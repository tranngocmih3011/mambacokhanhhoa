/**
 * BACO KHANH HOA - BẢO VỆ MÃ NGUỒN & TỐI ƯU TRẢI NGHIỆM
 * Ẩn chức năng click chuột phải để xem mã nguồn.
 * Hoàn toàn im lặng khi bấm chuột phải (không hiển thị bất kỳ thông báo hay alert nào).
 */
(function() {
    'use strict';

    // 1. Chặn click chuột phải trên toàn bộ website (không hiện thông báo)
    document.addEventListener('contextmenu', function(e) {
        // Cho phép thao tác sao chép/dán tự nhiên khi đang thao tác trong ô nhập liệu
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            return;
        }
        e.preventDefault();
        return false;
    }, true);

    // 2. Chặn các phím tắt xem mã nguồn & mở công cụ kiểm tra (F12, Ctrl/Cmd + U, Ctrl/Cmd + Shift + I/J/C, Ctrl/Cmd + S)
    document.addEventListener('keydown', function(e) {
        // F12
        if (e.keyCode === 123 || e.key === 'F12') {
            e.preventDefault();
            return false;
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

        // Ctrl/Cmd + Shift + I / J / C (Kiểm tra phần tử / Console)
        if (ctrlOrCmd && e.shiftKey && (
            e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || 
            e.key === 'I' || e.key === 'J' || e.key === 'C' || 
            e.key === 'i' || e.key === 'j' || e.key === 'c'
        )) {
            e.preventDefault();
            return false;
        }

        // Ctrl/Cmd + U (Xem nguồn trang - View Source)
        if (ctrlOrCmd && (e.keyCode === 85 || e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            return false;
        }

        // Ctrl/Cmd + S (Lưu trang mã nguồn về máy)
        if (ctrlOrCmd && (e.keyCode === 83 || e.key === 's' || e.key === 'S')) {
            if (!(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) {
                e.preventDefault();
                return false;
            }
        }
    }, true);
})();
