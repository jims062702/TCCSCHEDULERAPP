/* TCC Class Schedule — offline shell.
 *
 * Ginagawa nitong mabubuksan ang app kahit walang signal. Nasa loob mismo ng
 * telepono ang iskedyul (localStorage), kaya ang kailangan lang iimbak ay ang
 * app mismo — ang Flutter engine at ang mga asset nito.
 *
 * Hindi tayo gumagamit ng listahan ng mga file na dapat i-download nang maaga.
 * Mga 45 MB ang buong build, pero iisang uri lang ng canvaskit ang aktwal na
 * ginagamit ng bawat browser. Kaya ang paraan dito: kung ano ang hinihingi ng
 * app sa unang pagbukas, iyon ang iniimbak — mga 13 MB imbes na 45.
 *
 * Dalawang paraan ng pagsagot:
 *
 *   Pahina (HTML)  — internet muna, cache kapag walang signal. Kaya agad
 *                    nakukuha ang bagong bersyon pagka-deploy.
 *   Iba pa         — cache muna para mabilis, tapos tahimik na kinukuha ang
 *                    bago sa likod. Sa susunod na pagbukas ay bago na.
 */

'use strict';

var CACHE = 'tcc-app-v1';

/* Ang maliliit at tiyak na kailangan. Ang mabibigat — canvaskit, mga font —
 * ay sasabay na lang habang ginagamit, dahil iba-iba ang pinipili ng bawat
 * browser at sayang ang mag-download ng hindi naman gagamitin. */
var SHELL = [
  './',
  'index.html',
  'manifest.json',
  'favicon.png',
  'flutter.js',
  'flutter_bootstrap.js',
];

/* Totoo kapag kababago lang na-install — bagong bisita, o bagong bersyon. */
var fresh = false;

self.addEventListener('install', function (event) {
  fresh = true;
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) {
        return c.addAll(SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function () {
        // Kapag may isang file na hindi makuha, huwag nang ipagpilitan —
        // mas mabuti ang bahagyang cache kaysa sa walang service worker.
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            return k === CACHE ? null : caches.delete(k);
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      })
      .then(reloadOnce),
  );
});

/* Muling ikinakarga ang pahina, isang beses lang, pagkatapos ng unang luklok.
 *
 * Kailangan ito: nauuna ang canvaskit at ang `main.dart.js` bago pa
 * makahawak ang service worker, kaya sa unang pagbukas ay hindi ito
 * nadadaanan at walang naiimbak. Kapag muling kinarga, dumadaan na ang
 * lahat dito. Kung wala ito ay kailangang buksan nang dalawang beses ang
 * app bago gumana offline.
 *
 * Halos wala itong halaga sa datos — nasa HTTP cache pa ng browser ang mga
 * file, kaya ang ginagawa lang nito ay ilipat ang mga iyon sa Cache API.
 * Ito rin ang ginagawa ng dating service worker ng Flutter. */
function reloadOnce() {
  if (!fresh) return;
  fresh = false;
  return self.clients
    .matchAll({ type: 'window' })
    .then(function (list) {
      list.forEach(function (c) {
        if (c.url && 'navigate' in c) c.navigate(c.url);
      });
    })
    .catch(function () {});
}

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Ang GET lang ang maiimbak, at sa sarili nating server lang.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(pageFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

/** Bagong pahina kapag may internet; ang naimbak kapag wala. */
function pageFirst(req) {
  return fetch(req)
    .then(function (res) {
      keep(req, res);
      return res;
    })
    .catch(function () {
      // Isang pahina lang ito, kaya ang index.html ang sagot sa lahat.
      // Tandaan: Promise ang ibinabalik ng `caches.match`, kaya laging
      // truthy ang `||` — kailangang isa-isahin ang pagsuri.
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        return caches.match('index.html').then(function (idx) {
          if (idx) return idx;
          return caches.match('./').then(function (root) {
            return root || offline();
          });
        });
      });
    });
}

/** Agad mula sa cache, tapos tahimik na nag-uupdate para sa susunod. */
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    var live = fetch(req)
      .then(function (res) {
        keep(req, res);
        return res;
      })
      .catch(function () {
        // Kailangang Response ang ibalik. Ang `undefined` sa `respondWith`
        // ay nagiging TypeError, at masisira ang buong pagkuha.
        return hit || offline();
      });

    return hit || live;
  });
}

function keep(req, res) {
  // Ang `opaque` na sagot ay hindi mababasa ang status, at hindi rin dapat
  // itago — baka error pala ang naimbak natin.
  if (!res || !res.ok || res.type === 'opaque') return;
  var copy = res.clone();
  caches.open(CACHE).then(function (c) {
    c.put(req, copy);
  });
}

function offline() {
  return new Response('', { status: 503, statusText: 'Offline' });
}
