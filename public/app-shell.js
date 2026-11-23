(function () {
  var confirmResolver = null;

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureConfirmSheet() {
    if (document.getElementById('opsaiConfirm')) return;
    var el = document.createElement('div');
    el.id = 'opsaiConfirm';
    el.className = 'opsai-sheet';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="opsai-sheet-card">' +
        '<h2 id="opsaiConfirmTitle">Please confirm</h2>' +
        '<p id="opsaiConfirmBody"></p>' +
        '<div class="opsai-sheet-actions">' +
          '<button type="button" class="opsai-sheet-btn primary" id="opsaiConfirmOk">Confirm</button>' +
          '<button type="button" class="opsai-sheet-btn" id="opsaiConfirmCancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target === el) closeConfirm(false);
    });
    document.getElementById('opsaiConfirmCancel').addEventListener('click', function () {
      closeConfirm(false);
    });
    document.getElementById('opsaiConfirmOk').addEventListener('click', function () {
      closeConfirm(true);
    });
  }

  function closeConfirm(ok) {
    var el = document.getElementById('opsaiConfirm');
    if (el) el.hidden = true;
    var resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(!!ok);
  }

  function openConfirm(opts) {
    opts = opts || {};
    ensureConfirmSheet();
    var el = document.getElementById('opsaiConfirm');
    var title = document.getElementById('opsaiConfirmTitle');
    var body = document.getElementById('opsaiConfirmBody');
    var okBtn = document.getElementById('opsaiConfirmOk');
    title.textContent = opts.title || 'Please confirm';
    body.innerHTML = opts.html || escHtml(opts.body || '');
    okBtn.textContent = opts.confirmLabel || 'Confirm';
    okBtn.className = 'opsai-sheet-btn primary' + (opts.danger ? ' danger' : '');
    document.getElementById('opsaiConfirmCancel').textContent = opts.cancelLabel || 'Cancel';
    el.hidden = false;
  }

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
    },
    /** In-app confirm sheet (replaces window.confirm). Returns Promise<boolean>. */
    confirm: function (opts) {
      return new Promise(function (resolve) {
        if (confirmResolver) closeConfirm(false);
        confirmResolver = resolve;
        openConfirm(opts);
      });
    },
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
        '<p>Add it to your Home Screen. It opens full screen — no browser bar, like a business app.</p>' +
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

  function storeQuery() {
    try {
      var id = new URLSearchParams(location.search).get('storeId');
      return id ? ('?storeId=' + encodeURIComponent(id)) : '';
    } catch (e) {
      return '';
    }
  }

  function pathTab() {
    var p = location.pathname.replace(/\/$/, '') || '/';
    if (p === '/crew' || p === '/chat') return 'chat';
    // Chat setup lives under More — don't treat it as a second "Agents" destination.
    if (p === '/tasks' && /panel=admin-crew/.test(location.search)) return 'more';
    if (p === '/tasks') return 'tasks';
    if (p === '/dashboard') return 'reports';
    if (p === '/billing') return 'billing';
    if (p === '/more' || p === '/pricing') return 'more';
    return '';
  }

  function usesDeskRail() {
    var p = location.pathname.replace(/\/$/, '') || '/';
    return p === '/crew' || p === '/chat' || p === '/tasks' || p === '/more' || p === '/billing';
  }

  function mountDeskRail() {
    if (mode !== 'app' || isPhone() || !usesDeskRail()) return;
    if (document.getElementById('opsaiRail')) return;
    root.classList.add('opsai-desk-rail');
    var q = storeQuery();
    var tab = pathTab();
    var rail = document.createElement('nav');
    rail.id = 'opsaiRail';
    rail.setAttribute('aria-label', 'Workspace');
    function item(href, id, ico, label) {
      return (
        '<a class="rail-item" href="' + href + '"' +
        (tab === id ? ' aria-current="page"' : '') + '>' +
        '<span class="rail-ico" aria-hidden="true">' + ico + '</span>' +
        '<span>' + label + '</span></a>'
      );
    }
    // Chat is the agent. Setup (name, capabilities, tools) lives under More — not a rival nav item.
    rail.innerHTML =
      '<a class="rail-brand" href="/crew' + q + '">' +
        '<img src="/logo.jpg" alt="">' +
        '<span>opsAi</span></a>' +
      '<div class="rail-label">Main</div>' +
      item('/crew' + q, 'chat', '◎', 'Chat') +
      item('/tasks' + q, 'tasks', '☰', 'Tasks') +
      item('/dashboard' + q, 'reports', '📈', 'Reports') +
      '<div class="rail-label">Workspace</div>' +
      item('/more' + q, 'more', '···', 'More') +
      '<div class="rail-spacer"></div>' +
      '<div class="rail-foot">' +
        item('/billing', 'billing', '💳', 'Billing') +
      '</div>';
    document.body.appendChild(rail);
  }

  function mountMobileTabs() {
    if (mode !== 'app' || !isPhone()) return;
    var tab = pathTab();
    if (!tab) return;
    if (document.getElementById('opsaiTabBar')) return;
    root.classList.add('opsai-mobile-tabs');
    var q = storeQuery();
    var bar = document.createElement('nav');
    bar.id = 'opsaiTabBar';
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML =
      '<a href="/crew' + q + '" data-tab="chat"' + (tab === 'chat' ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ico" aria-hidden="true">◎</span><span>Chat</span></a>' +
      '<a href="/tasks' + q + '" data-tab="tasks"' + (tab === 'tasks' ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ico" aria-hidden="true">☰</span><span>Tasks</span></a>' +
      '<a href="/more' + q + '" data-tab="more"' + (tab === 'more' || tab === 'reports' || tab === 'billing' ? ' aria-current="page"' : '') + '>' +
        '<span class="tab-ico" aria-hidden="true">···</span><span>More</span></a>';
    document.body.appendChild(bar);
  }

  function onReady() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
    document.addEventListener('click', keepInApp);
    ensureConfirmSheet();
    mountDeskRail();
    mountMobileTabs();
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
