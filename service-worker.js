// service-worker.js

// تحديد اسم الكاش (يجب تغييره عند تحديث التطبيق لضمان التحديث)
const CACHE_NAME = 'maktabati-v1.0.1'; // تم تحديث الإصدار بعد تصحيح المسارات

// قائمة الملفات الأساسية التي يجب تخزينها فوراً (تم تحديث المسارات والأسماء)
const urlsToCache = [
  './', // المسار الرئيسي
  './index.html',
  './css/style.css',
  './js/app.js',
  // الأيقونات والموارد الأخرى من ملف Manifest - تم تصحيح الأسماء
  './manifest.json', // إضافة ملف البيان
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/maskable-icon.png'
];

// ----------------------------------------------------
// 1. تثبيت عامل الخدمة (Installation)
// يتم تخزين الملفات الثابتة في هذا الحدث
// ----------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache. Pre-caching static assets.');
        // تخزين جميع الموارد المذكورة أعلاه
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // لتنشيط عامل الخدمة فوراً دون انتظار إغلاق الصفحات القديمة
});

// ----------------------------------------------------
// 2. تفعيل عامل الخدمة (Activation)
// يتم تنظيف الكاشات القديمة هنا
// ----------------------------------------------------
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // حذف أي كاش قديم لا يتطابق مع اسم الكاش الحالي
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // السيطرة على العميل (الصفحة) فوراً
});

// ----------------------------------------------------
// 3. استراتيجية جلب البيانات (Fetch Strategy)
// استراتيجية: Cache-First
// ----------------------------------------------------
self.addEventListener('fetch', (event) => {
  // تخطي الطلبات غير المتعلقة بالمتصفح أو غير القابلة للتخزين المؤقت
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension')) {
    return;
  }
  
  // الاستجابة بـ: البحث أولاً في الكاش، ثم الشبكة
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 1. إذا كان المورد موجوداً في الكاش، قم بإرجاعه
        if (response) {
          return response;
        }
        
        // 2. إذا لم يكن موجوداً، اذهب إلى الشبكة
        return fetch(event.request).then(
          (response) => {
            // تحقق من استجابة صالحة (HTTP 200)
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 3. تخزين الاستجابة الجديدة ديناميكياً قبل إرجاعها
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                // تجنب تخزين البيانات الكبيرة جداً ديناميكياً (مثل الملفات المرفقة)
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});
