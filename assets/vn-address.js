// assets/vn-address.js
// Bộ chọn địa chỉ 3 cấp Việt Nam + Hàng đợi đồng bộ chống quá tải + Kiểm tra Voucher dùng chung
(function (global) {
    'use strict';

    const VN_API_BASE = 'https://provinces.open-api.vn/api';
    const PROVINCE_CACHE_KEY = 'baco_vn_provinces_v1';
    const PENDING_QUEUE_KEY = 'baco_pending_sync_queue';

    const DEFAULT_VOUCHERS = [
        { code: 'BACO20', type: 'fixed', value: 20000, minOrder: 200000, maxDiscount: 20000, active: true, note: 'Giảm 20.000đ đơn từ 200k' },
        { code: 'FREESHIP', type: 'freeship', value: 30000, minOrder: 0, maxDiscount: 30000, active: true, note: 'Miễn phí vận chuyển toàn quốc' },
        { code: 'VIP10', type: 'percent', value: 10, minOrder: 350000, maxDiscount: 50000, active: true, note: 'Giảm 10% tối đa 50k đơn từ 350k' }
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
            const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function loadProvinces() {
        try {
            const raw = localStorage.getItem(PROVINCE_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.data) && parsed.ts && (Date.now() - parsed.ts < 7 * 86400 * 1000)) {
                    return parsed.data;
                }
            }
        } catch (e) {}
        const data = await fetchJsonWithTimeout(VN_API_BASE + '/p/?depth=1');
        try {
            localStorage.setItem(PROVINCE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
        } catch (e) {}
        return data;
    }

    function initVnAddressSelector(opts) {
        const container = document.getElementById(opts.containerId);
        const targetInput = document.getElementById(opts.targetInputId);
        if (!container || !targetInput) return;

        const uid = opts.containerId;
        container.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select id="${uid}_prov" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="">Tỉnh / Thành phố...</option>
                </select>
                <select id="${uid}_dist" disabled class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60">
                    <option value="">Quận / Huyện...</option>
                </select>
                <select id="${uid}_ward" disabled class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60">
                    <option value="">Phường / Xã...</option>
                </select>
            </div>
            <input id="${uid}_street" type="text" placeholder="Số nhà, tên đường / thôn xóm..." class="mt-2 w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
        `;

        const provEl = document.getElementById(uid + '_prov');
        const distEl = document.getElementById(uid + '_dist');
        const wardEl = document.getElementById(uid + '_ward');
        const streetEl = document.getElementById(uid + '_street');

        function syncTargetAddress() {
            const pName = provEl.options[provEl.selectedIndex]?.dataset?.name || '';
            const dName = distEl.options[distEl.selectedIndex]?.dataset?.name || '';
            const wName = wardEl.options[wardEl.selectedIndex]?.dataset?.name || '';
            const street = (streetEl.value || '').trim();
            const parts = [street, wName, dName, pName].filter(Boolean);
            if (parts.length > 0) {
                targetInput.value = parts.join(', ');
            }
        }

        // Ẩn ô nhập tay gốc nếu đã có bộ chọn 3 cấp (vẫn giữ value để submit)
        targetInput.classList.add('hidden');
        targetInput.removeAttribute('required');
        streetEl.addEventListener('input', syncTargetAddress);

        loadProvinces().then((provinces) => {
            if (!Array.isArray(provinces) || provinces.length === 0) throw new Error('Empty');
            provEl.innerHTML = '<option value="">Tỉnh / Thành phố...</option>' +
                provinces.map(p => `<option value="${esc(p.code)}" data-name="${esc(p.name)}">${esc(p.name)}</option>`).join('');
        }).catch(() => {
            // Fallback: Nếu API hành chính lỗi/chậm, mở lại ô nhập địa chỉ tự do để không chặn khách đặt hàng
            container.classList.add('hidden');
            targetInput.classList.remove('hidden');
            targetInput.setAttribute('required', 'required');
        });

        provEl.addEventListener('change', async () => {
            const pCode = provEl.value;
            distEl.innerHTML = '<option value="">Đang tải...</option>';
            distEl.disabled = true;
            wardEl.innerHTML = '<option value="">Phường / Xã...</option>';
            wardEl.disabled = true;
            syncTargetAddress();
            if (!pCode) {
                distEl.innerHTML = '<option value="">Quận / Huyện...</option>';
                return;
            }
            try {
                const data = await fetchJsonWithTimeout(`${VN_API_BASE}/p/${encodeURIComponent(pCode)}?depth=2`);
                const districts = (data && data.districts) || [];
                distEl.innerHTML = '<option value="">Quận / Huyện...</option>' +
                    districts.map(d => `<option value="${esc(d.code)}" data-name="${esc(d.name)}">${esc(d.name)}</option>`).join('');
                distEl.disabled = false;
                distEl.classList.remove('bg-slate-50');
                distEl.classList.add('bg-white');
            } catch (e) {
                distEl.innerHTML = '<option value="">Không tải được Huyện</option>';
            }
        });

        distEl.addEventListener('change', async () => {
            const dCode = distEl.value;
            wardEl.innerHTML = '<option value="">Đang tải...</option>';
            wardEl.disabled = true;
            syncTargetAddress();
            if (!dCode) {
                wardEl.innerHTML = '<option value="">Phường / Xã...</option>';
                return;
            }
            try {
                const data = await fetchJsonWithTimeout(`${VN_API_BASE}/d/${encodeURIComponent(dCode)}?depth=2`);
                const wards = (data && data.wards) || [];
                wardEl.innerHTML = '<option value="">Phường / Xã...</option>' +
                    wards.map(w => `<option value="${esc(w.code)}" data-name="${esc(w.name)}">${esc(w.name)}</option>`).join('');
                wardEl.disabled = false;
                wardEl.classList.remove('bg-slate-50');
                wardEl.classList.add('bg-white');
            } catch (e) {
                wardEl.innerHTML = '<option value="">Không tải được Xã</option>';
            }
        });

        wardEl.addEventListener('change', syncTargetAddress);
    }

    // Kiểm tra & tính giảm giá Voucher (hỗ trợ cả Sheet online + fallback localStorage)
    function evaluateVoucherLocally(codeRaw, subtotal) {
        const code = String(codeRaw || '').trim().toUpperCase();
        if (!code) return { valid: false, message: 'Vui lòng nhập mã giảm giá.' };
        let list = DEFAULT_VOUCHERS;
        try {
            const stored = JSON.parse(localStorage.getItem('baco_vouchers') || 'null');
            if (Array.isArray(stored) && stored.length > 0) list = stored;
        } catch (e) {}
        const found = list.find(v => String(v.code || '').toUpperCase() === code);
        if (!found || found.active === false) {
            return { valid: false, message: 'Mã giảm giá không tồn tại hoặc đã hết hạn.' };
        }
        const minOrder = Number(found.minOrder) || 0;
        if (minOrder > 0 && subtotal < minOrder) {
            return { valid: false, message: `Mã ${code} áp dụng cho đơn từ ${minOrder.toLocaleString('vi-VN')}đ.` };
        }
        let discountAmount = 0;
        let freeShipping = false;
        if (found.type === 'freeship') {
            freeShipping = true;
        } else if (found.type === 'percent') {
            discountAmount = Math.round((subtotal * (Number(found.value) || 0)) / 100);
            const maxD = Number(found.maxDiscount) || 0;
            if (maxD > 0 && discountAmount > maxD) discountAmount = maxD;
        } else {
            discountAmount = Math.min(Number(found.value) || 0, subtotal);
        }
        return {
            valid: true,
            voucher: {
                code: found.code,
                type: found.type,
                value: Number(found.value) || 0,
                discountAmount,
                freeShipping,
                note: found.note || ''
            }
        };
    }

    async function verifyVoucherWithSheet(scriptUrl, codeRaw, subtotal) {
        const code = String(codeRaw || '').trim().toUpperCase();
        if (!code) return { valid: false, message: 'Vui lòng nhập mã giảm giá.' };
        try {
            const url = `${scriptUrl}?action=verify_voucher&code=${encodeURIComponent(code)}&subtotal=${encodeURIComponent(subtotal)}&_t=${Date.now()}`;
            const res = await fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' });
            if (res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    if (json && json.status === 'success') return json;
                } catch (parseErr) {}
            }
        } catch (e) {}
        return evaluateVoucherLocally(code, subtotal);
    }

    // Gửi đơn hàng qua Edge Proxy (/api/sheet-cache) + fallback mode: 'no-cors' không gửi trùng
    function enqueuePendingSync(payload) {
        try {
            const q = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || '[]');
            q.push({ ts: Date.now(), payload });
            localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(q.slice(-20)));
        } catch (e) {}
    }

    async function flushPendingSyncQueue(scriptUrl) {
        let q = [];
        try {
            q = JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || '[]');
        } catch (e) { return; }
        if (!Array.isArray(q) || q.length === 0) return;

        const remaining = [];
        const useEdge = (location.protocol === 'http:' || location.protocol === 'https:');

        for (const item of q) {
            if (!item || !item.payload) continue;
            if (Date.now() - (item.ts || 0) > 24 * 3600 * 1000) continue;
            let sent = false;
            if (useEdge) {
                try {
                    const res = await fetch('/api/sheet-cache', {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify(item.payload),
                        redirect: 'follow'
                    });
                    if (res.ok) sent = true;
                } catch (e) {}
            }
            if (!sent) {
                try {
                    await fetch(scriptUrl, {
                        method: 'POST',
                        mode: 'no-cors',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify(item.payload)
                    });
                    sent = true;
                } catch (e) {}
            }
            if (!sent) remaining.push(item);
        }
        try {
            localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(remaining));
        } catch (e) {}
    }

    async function sendOrderResilient(scriptUrl, payload) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            enqueuePendingSync(payload);
            return false;
        }
        const useEdge = (location.protocol === 'http:' || location.protocol === 'https:');
        if (useEdge) {
            try {
                const res = await fetch('/api/sheet-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload),
                    redirect: 'follow'
                });
                if (res.ok) return true;
            } catch (e) {}
        }
        try {
            await fetch(scriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            return true;
        } catch (e) {
            enqueuePendingSync(payload);
            return false;
        }
    }

    global.BaCoStoreUtils = {
        DEFAULT_VOUCHERS,
        initVnAddressSelector,
        evaluateVoucherLocally,
        verifyVoucherWithSheet,
        flushPendingSyncQueue,
        sendOrderResilient
    };
})(window);
