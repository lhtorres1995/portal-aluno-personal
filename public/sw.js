/* LT360 — Portal do Aluno: service worker mínimo (instalável + offline básico).
   NÃO intercepta chamadas de outra origem (Supabase auth/REST passam direto). */
var CACHE = 'lt360-portal-v1';

self.addEventListener('install', function(e){ self.skipWaiting(); });

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(_) { return; }
  if (url.origin !== self.location.origin) return; // Supabase e terceiros: não intercepta

  // Navegação: rede primeiro, cache do app shell como fallback offline.
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(function(res){
        var copia = res.clone();
        caches.open(CACHE).then(function(c){ c.put('/', copia); });
        return res;
      }).catch(function(){ return caches.match('/'); })
    );
    return;
  }

  // Estáticos same-origin (JS/CSS/imagens com hash): cache primeiro, rede preenche.
  e.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req).then(function(res){
        if (res && res.status === 200 && res.type === 'basic'){
          var copia = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copia); });
        }
        return res;
      });
    })
  );
});

/* ---------------- Push (notificações) ---------------------------------- */
self.addEventListener('push', function(e){
  var data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch(_){ data = { title: 'LT360', body: e.data ? e.data.text() : '' }; }
  var title = data.title || 'LT360';
  var opts = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins){
      for (var i=0;i<wins.length;i++){
        var w = wins[i];
        if (w.url.indexOf(self.location.origin) === 0 && 'focus' in w){
          w.focus();
          if (w.navigate) { try { w.navigate(url); } catch(_){} }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
