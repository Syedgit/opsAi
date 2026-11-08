(function () {
  window.opsai = {
    me: function () {
      return fetch('/api/auth/me').then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; });
    },
    logout: function () {
      return fetch('/api/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        try {
          localStorage.removeItem('authToken');
          localStorage.removeItem('user');
          localStorage.removeItem('skipOwnerOnboarding');
        } catch (e) {}
        location.href = '/login';
      });
    }
  };

  var root = document.documentElement;
  var mode = root.getAttribute('data-app-shell') || 'app';
  var standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  if (standalone) root.classList.add('app-standalone');

  if (standalone && mode === 'app' && !sessionStorage.getItem('opsai-inapp')) {
    root.classList.add('app-launch');
  }

  function hideSplash() {
    sessionStorage.setItem('opsai-inapp', '1');
    var splash = document.getElementById('appSplash');
    root.classList.remove('app-launch');
    if (!splash) return;
    splash.classList.add('go');
    setTimeout(function () {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 320);
  }

  function sameOrigin(href) {
    try {
      return new URL(href, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function keepInApp(event) {
    var a = event.target.closest && event.target.closest('a[href]');
    if (!a || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!sameOrigin(a.href)) return;
    if (a.hasAttribute('download')) return;
    if (a.getAttribute('href').charAt(0) === '#') return;
    if (a.target === '_blank') {
      event.preventDefault();
      location.assign(a.href);
    }
  }

  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
  });

  function isPhone() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches || window.innerWidth <= 768;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function dismissKey() {
    return 'opsai-install-dismissed';
  }

  function shouldOfferInstall() {
    if (standalone || mode !== 'app' || !isPhone()) return false;
    var until = Number(localStorage.getItem(dismissKey()) || 0);
    return Date.now() > until;
  }

  function closeInstall() {
    var el = document.getElementById('appInstall');
    if (el) el.classList.remove('open');
  }

  function snoozeInstall() {
    localStorage.setItem(dismissKey(), String(Date.now() + 14 * 24 * 60 * 60 * 1000));
    closeInstall();
  }

  function showInstall() {
    if (!shouldOfferInstall() || document.getElementById('appInstall')) return;
    var ios = isIos();
    var sheet = document.createElement('div');
    sheet.id = 'appInstall';
    sheet.innerHTML =
      '<div class="app-install-bg" data-install-dismiss="1"></div>' +
      '<div class="app-install-sheet" role="dialog" aria-labelledby="appInstallTitle">' +
        '<div class="app-install-handle"></div>' +
        '<h2 id="appInstallTitle">Open opsAi as an app</h2>' +
        '<p>Add it to your Home Screen. It opens full screen — no browser bar, like a store app.</p>' +
        (ios
          ? '<ol><li>Tap the Share button</li><li>Tap <strong>Add to Home Screen</strong></li><li>Open the opsAi icon</li></ol>'
          : '<p>Use the button below, or Chrome’s Install app menu.</p>') +
        '<div class="app-install-actions">' +
          (ios
            ? '<button type="button" class="app-install-primary" data-install-dismiss="1">Got it</button>'
            : '<button type="button" class="app-install-primary" data-install-android="1">Add to Home Screen</button>') +
          '<button type="button" class="app-install-ghost" data-install-dismiss="1">Not now</button>' +
        '</div>' +
      '</div>';
    sheet.addEventListener('click', function (event) {
      var t = event.target;
      if (t.getAttribute && t.getAttribute('data-install-android')) {
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.then(function () {
            installPrompt = null;
            snoozeInstall();
          });
        } else {
          snoozeInstall();
        }
        return;
      }
      if (t.getAttribute && t.getAttribute('data-install-dismiss')) snoozeInstall();
    });
    document.body.appendChild(sheet);
    sheet.classList.add('open');
  }

  function onReady() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
    document.addEventListener('click', keepInApp);
    if (root.classList.contains('app-launch')) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        hideSplash();
      };
      setTimeout(finish, 700);
      window.addEventListener('load', finish);
    } else {
      hideSplash();
    }
    if (shouldOfferInstall()) setTimeout(showInstall, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
