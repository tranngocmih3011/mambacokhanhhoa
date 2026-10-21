// Service Worker cho Nước Mắm Ba Cô Admin (Hỗ trợ PWA & Web Push Notification trên iOS 16.4+, Android & PC)
const CACHE_NAME = 'baco-admin-v3';

async function syncSwAppBadge(explicitCount) {
    try {
        if (!self.navigator || typeof self.navigator.setAppBadge !== 'function') return;
        if (typeof explicitCount === 'number') {
            if (explicitCount > 0) {
                await self.navigator.setAppBadge(explicitCount);
            } else if (typeof self.navigator.clearAppBadge === 'function') {
                await self.navigator.clearAppBadge();
            }
            return;
        }
        const activeNotifs = await self.registration.getNotifications();
        const count = (activeNotifs && activeNotifs.length) ? activeNotifs.length : 1;
        await self.navigator.setAppBadge(count);
    } catch (e) {}
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Lắng nghe lệnh hiển thị thông báo đẩy hoặc cập nhật badge từ client script
self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'SET_APP_BADGE') {
        event.waitUntil(syncSwAppBadge(Number(event.data.count || 0)));
        return;
    }
    if (event.data.type === 'SHOW_NOTIFICATION') {
        const payload = event.data.payload || {};
        const options = {
            body: payload.body || 'Bạn có thông báo mới',
            icon: './pictrure/logo.JPG',
            badge: './pictrure/logo.JPG',
            vibrate: [300, 100, 300, 100, 300],
            tag: payload.tag || ('baco-order-' + Date.now()),
            renotify: true,
            requireInteraction: true,
            data: {
                url: payload.url || './admin.html',
                code: payload.code || '',
                type: payload.type || 'orders'
            }
        };
        event.waitUntil(
            self.registration.showNotification(payload.title || '🔔 Nước Mắm Ba Cô', options)
                .then(() => syncSwAppBadge(payload.badgeCount))
        );
    }
});

// Xử lý sự kiện nhận Push từ máy chủ (Apple APNs / FCM / Mozilla)
self.addEventListener('push', (event) => {
    let data = { title: '🔔 Đơn Hàng Mới!', body: 'Có thông báo mới từ Nước Mắm Ba Cô', url: './admin.html', code: '', type: 'orders' };
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const uniqueTag = 'baco-' + (data.code || Date.now());
    const options = {
        body: data.body,
        icon: './pictrure/logo.JPG',
        badge: './pictrure/logo.JPG',
        vibrate: [300, 100, 300, 100, 300],
        tag: uniqueTag,
        renotify: true,
        requireInteraction: true,
        data: {
            url: data.url || './admin.html',
            code: data.code || '',
            type: data.type || 'orders'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🔔 Nước Mắm Ba Cô', options)
            .then(() => syncSwAppBadge())
    );
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
