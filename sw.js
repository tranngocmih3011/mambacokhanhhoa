// Service Worker cho Nước Mắm Ba Cô Admin (Hỗ trợ PWA & Web Push Notification trên iOS 16.4+, Android & PC)
const CACHE_NAME = 'baco-admin-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Lắng nghe lệnh hiển thị thông báo đẩy từ client script
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const payload = event.data.payload || {};
        const options = {
            body: payload.body || 'Bạn có thông báo mới',
            icon: './pictrure/logo.JPG',
            badge: './pictrure/logo.JPG',
            vibrate: [200, 100, 200, 100, 200],
            tag: payload.tag || 'baco-order-' + Date.now(),
            renotify: true,
            data: {
                url: payload.url || './admin.html'
            }
        };
        self.registration.showNotification(payload.title || '🔔 Nước Mắm Ba Cô', options);
    }
});

// Xử lý sự kiện nhận Push từ máy chủ (nếu kết nối Web Push)
self.addEventListener('push', (event) => {
    let data = { title: '🔔 Đơn hàng mới!', body: 'Có thông báo mới từ Nước Mắm Ba Cô', url: './admin.html' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: './pictrure/logo.JPG',
        badge: './pictrure/logo.JPG',
        vibrate: [200, 100, 200, 100, 200],
        tag: 'baco-order-notif',
        renotify: true,
        data: {
            url: data.url || './admin.html'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🔔 Nước Mắm Ba Cô', options)
    );
});

// Xử lý khi người dùng chạm vào thông báo trên điện thoại
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || './admin.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url.includes('admin.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
