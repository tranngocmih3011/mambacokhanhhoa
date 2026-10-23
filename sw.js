// Service Worker cho Nước Mắm Ba Cô Admin (Hỗ trợ PWA & Web Push Notification trên iOS 16.4+, Android & PC)
const CACHE_NAME = 'baco-admin-v10';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

async function safeSetBadge(count) {
    try {
        if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
            const badgeNum = (typeof count === 'number' && count >= 0) ? count : 1;
            if (badgeNum === 0) {
                if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
            } else {
                await self.navigator.setAppBadge(badgeNum);
            }
        }
    } catch(e) {}
}

self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SET_APP_BADGE') {
        event.waitUntil(safeSetBadge(Number(event.data.count || 0)));
        return;
    }
    if (event.data.type === 'SHOW_NOTIFICATION') {
        const payload = event.data.payload || {};
        const options = {
            body: payload.body || 'Bạn có thông báo mới',
            tag: payload.tag || ('baco-order-' + Date.now()),
            data: {
                url: payload.url || './admin.html',
                code: payload.code || '',
                type: payload.type || 'orders'
            }
        };
        event.waitUntil((async () => {
            try {
                await self.registration.showNotification(payload.title || '🔔 Nước Mắm Ba Cô', options);
            } catch(e) {
                try {
                    await self.registration.showNotification(payload.title || '🔔 Nước Mắm Ba Cô', { body: payload.body || 'Bạn có thông báo mới' });
                } catch(e2) {}
            }
            await safeSetBadge(payload.badgeCount);
        })());
    }
});

// Xử lý sự kiện nhận Push từ máy chủ (Apple APNs / FCM / Mozilla) khi tắt màn hình / không dùng app
self.addEventListener('push', (event) => {
    let data = {
        title: '🛒 Đơn Hàng Mới - Ba Cô',
        body: 'Bạn có đơn hàng mới vừa được gửi tới!',
        url: './admin.html',
        code: '',
        type: 'orders'
    };

    if (event.data) {
        try {
            const parsed = event.data.json();
            data = Object.assign(data, parsed);
        } catch (e) {
            try { data.body = event.data.text(); } catch (e2) {}
        }
    }

    const uniqueTag = 'baco-' + (data.code || Date.now());

    // Các tham số chuẩn 100% tương thích Apple WebKit iOS 16.4+ và Android
    // Tuyệt đối không để icon lớn hay renotify để tránh lỗi WebKit từ chối hiển thị khi màn hình khóa
    const options = {
        body: data.body || 'Khách hàng vừa đặt hàng thành công!',
        tag: uniqueTag,
        data: {
            url: data.url || './admin.html',
            code: data.code || '',
            type: data.type || 'orders'
        }
    };

    event.waitUntil((async () => {
        // 1. Luôn hiển thị thông báo ra Màn hình khóa iPhone / Android (kể cả khi không mở app)
        try {
            await self.registration.showNotification(data.title || '🔔 Nước Mắm Ba Cô', options);
        } catch (err) {
            try {
                await self.registration.showNotification(data.title || '🔔 Nước Mắm Ba Cô', {
                    body: data.body || 'Bạn có đơn hàng mới!'
                });
            } catch (err2) {
                console.error('Không thể hiển thị notification:', err2);
            }
        }

        // 2. Cập nhật số đếm badge đỏ ngoài màn hình chính
        await safeSetBadge();

        // 3. Nếu ứng dụng đang mở trong màn hình thì báo hiệu tức thì
        try {
            const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of windowClients) {
                client.postMessage({
                    type: 'PUSH_NOTIFICATION_RECEIVED',
                    payload: data
                });
            }
        } catch(e) {}
    })());
});

// Xử lý khi người dùng chạm vào thông báo trên điện thoại (Màn hình khóa hoặc Biểu ngữ)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const notifData = (event.notification && event.notification.data) || {};
    let targetUrl = notifData.url || './admin.html';
    if (notifData.code) {
        targetUrl = `./admin.html?viewNotif=${encodeURIComponent(notifData.code)}&type=${encodeURIComponent(notifData.type || 'orders')}`;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url.includes('admin.html') && 'focus' in client) {
                    if (notifData.code) {
                        client.postMessage({
                            type: 'OPEN_NOTIFICATION_ITEM',
                            code: notifData.code,
                            itemType: notifData.type || 'orders'
                        });
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
