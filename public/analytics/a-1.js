/*! cm-analytics v1: first-party, cookie-free usage analytics. Docs: docs/analytics/EVENTS.md */
// Load as an external, deferred script tag with these attributes (see docs/analytics/ONBOARDING.md):
//   src="/analytics/a-1.js" defer data-project="portfolio"
//   data-endpoint="https://christian-mcclellan.vercel.app/api"
//   data-production-host="christian-mcclellan.vercel.app"
//
// Guarantees:
// * Sends nothing (beyond a consent-region lookup) until analytics is allowed. Visitors in the
//   EEA, UK and Switzerland, or anywhere the region is unknown, must accept first. Global Privacy
//   Control or Do Not Track turns analytics off entirely, with no requests at all.
// * No cookies. No persistent visitor id. A random session id lives in sessionStorage (this tab
//   only) and is replaced after 30 idle minutes.
// * Never reads form fields, input values, page text, or query strings.
// * Every code path is wrapped so a failure here cannot break the host page.
(function () {
  'use strict';
  var w = window;
  var d = document;
  if (w.cmAnalytics) return;

  var VERSION = 1;
  var CONSENT_KEY = 'cm_analytics_consent_v1';
  var SESSION_KEY = 'cm_analytics_session_v1';
  var CONSENT_TTL = 365 * 24 * 3600e3;
  var SESSION_IDLE = 30 * 60e3;
  var ACTIVE_IDLE = 60e3; // no input for 60 s = idle; active time stops counting
  var FLUSH_MS = 5000;
  var MAX_QUEUE = 50;
  var MAX_BATCH = 20;
  var MAX_ERRORS = 5;

  var script = d.currentScript;
  if (!script) return;
  var attr = function (n) { return script.getAttribute(n); };
  var cfg = {
    project: attr('data-project'),
    endpoint: (attr('data-endpoint') || '/api').replace(/\/+$/, ''),
    release: attr('data-release') || null,
    productionHosts: (attr('data-production-host') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    // data-hash-routing: '#/view' routes; data-hash-routing="plain": any '#view' is a route.
    hashRouting: script.hasAttribute('data-hash-routing') ? (attr('data-hash-routing') || 'slash') : null,
    privacyUrl: attr('data-privacy-url') || '/privacy',
    css: attr('data-css') || (script.src || '').replace(/\.js(\?.*)?$/, '.css'),
  };
  if (!cfg.project) return;

  var state = { mode: 'pending', reason: null }; // pending | on | off
  var queue = [];
  var session = null;
  var currentPath = null;
  var activeMs = 0;
  var lastInput = Date.now();
  var lastTick = Date.now();
  var errorsSent = {};
  var errorCount = 0;
  var vitals = {};
  var vitalsSent = false;
  var flushTimer = null;
  var listenersOn = false;

  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { /* never break the host page */ }
    };
  }

  function env() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.localhost$/.test(h)) return 'development';
    if (cfg.productionHosts.length && cfg.productionHosts.indexOf(h) === -1) return 'preview';
    return 'production';
  }

  function uuid() {
    if (w.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function store(kind) {
    try { return kind === 'local' ? w.localStorage : w.sessionStorage; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Consent
  // ---------------------------------------------------------------------------
  function privacySignal() {
    var n = navigator;
    return n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1' || n.msDoNotTrack === '1';
  }

  function readChoice() {
    var s = store('local');
    if (!s) return null;
    try {
      var v = JSON.parse(s.getItem(CONSENT_KEY) || 'null');
      if (v && (v.c === 'granted' || v.c === 'denied') && Date.now() - v.at < CONSENT_TTL) return v.c;
    } catch (e) { /* ignore */ }
    return null;
  }

  function saveChoice(c) {
    var s = store('local');
    // Storing the visitor's own choice is strictly necessary to respect it.
    if (s) try { s.setItem(CONSENT_KEY, JSON.stringify({ c: c, at: Date.now() })); } catch (e) { /* ignore */ }
  }

  function setChoice(c) {
    saveChoice(c);
    hideBanner();
    if (c === 'granted') start();
    else stop('rejected');
  }

  function decide() {
    if (privacySignal()) { stop('signal'); return; }
    var choice = readChoice();
    if (choice === 'granted') { start(); return; }
    if (choice === 'denied') { stop('rejected'); return; }
    regionNeedsConsent(function (required) {
      if (required) showBanner();
      else start();
    });
  }

  function regionNeedsConsent(cb) {
    var done = false;
    var finish = function (v) { if (!done) { done = true; cb(v); } };
    try {
      var ctrl = w.AbortController ? new AbortController() : null;
      setTimeout(function () { if (ctrl) ctrl.abort(); finish(true); }, 3000);
      fetch(cfg.endpoint + '/region', { credentials: 'omit', cache: 'no-store', signal: ctrl && ctrl.signal })
        .then(function (r) { return r.json(); })
        .then(function (j) { finish(!(j && j.consent === 'notice')); })
        .catch(function () { finish(true); }); // unknown: ask first
    } catch (e) { finish(true); }
  }

  // ---------------------------------------------------------------------------
  // Consent UI (styles in a-1.css; no inline styles, so strict CSPs work)
  // ---------------------------------------------------------------------------
  var banner = null;
  var dialog = null;
  var lastOpener = null;

  function loadCss() {
    if (!cfg.css || d.querySelector('link[data-cma-css]')) return;
    var l = d.createElement('link');
    l.rel = 'stylesheet';
    l.href = cfg.css;
    l.setAttribute('data-cma-css', '');
    d.head.appendChild(l);
  }

  function el(tag, props, children) {
    var e = d.createElement(tag);
    for (var k in props) {
      if (k === 'text') e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    }
    (children || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return e;
  }

  function showBanner() {
    if (banner || !d.body) return;
    loadCss();
    var text = el('p', { id: 'cma-banner-text', class: 'cma-text' }, [
      'Can this site count your visit? It uses first-party analytics with no cookies and no ads. Nothing is sent unless you allow it. ',
      el('a', { href: cfg.privacyUrl, text: 'Privacy details' }),
    ]);
    var accept = el('button', { type: 'button', class: 'cma-btn', 'data-cma': 'accept', text: 'Allow analytics' });
    var reject = el('button', { type: 'button', class: 'cma-btn', 'data-cma': 'reject', text: 'Don’t allow' });
    var prefs = el('button', { type: 'button', class: 'cma-btn cma-btn-quiet', 'data-cma': 'prefs', text: 'Preferences' });
    banner = el('section', { class: 'cma-banner', 'aria-labelledby': 'cma-banner-title' }, [
      el('h2', { id: 'cma-banner-title', class: 'cma-title', text: 'Analytics choice' }),
      text,
      el('div', { class: 'cma-actions' }, [accept, reject, prefs]),
    ]);
    accept.addEventListener('click', safe(function () { setChoice('granted'); }));
    reject.addEventListener('click', safe(function () { setChoice('denied'); }));
    prefs.addEventListener('click', safe(function () { openPreferences(prefs); }));
    // Early in the reading/tab order, but after a leading "skip to content" link.
    var first = d.body.firstElementChild;
    var skip = first && first.matches && first.matches('a[href^="#"]') ? first : null;
    d.body.insertBefore(banner, skip ? skip.nextSibling : d.body.firstChild);
    // Keep focused content from hiding behind the fixed banner (WCAG 2.4.11).
    var h = banner.offsetHeight;
    d.documentElement.style.setProperty('--cma-banner-h', h + 'px');
    d.documentElement.classList.add('cma-has-banner');
  }

  function hideBanner() {
    if (!banner) return;
    banner.remove();
    banner = null;
    d.documentElement.classList.remove('cma-has-banner');
    d.documentElement.style.removeProperty('--cma-banner-h');
  }

  function openPreferences(opener) {
    if (!d.body) return;
    loadCss();
    lastOpener = opener || d.activeElement;
    if (dialog) dialog.remove();
    var signal = privacySignal();
    var on = state.mode === 'on';
    var box = el('input', { type: 'checkbox', id: 'cma-analytics', class: 'cma-check' });
    box.checked = on && !signal;
    if (signal) box.disabled = true;
    var save = el('button', { type: 'button', class: 'cma-btn', text: 'Save choice' });
    var cancel = el('button', { type: 'button', class: 'cma-btn cma-btn-quiet', text: 'Cancel' });
    var body = [
      el('h2', { id: 'cma-dialog-title', class: 'cma-title', text: 'Privacy choices' }),
      el('p', { class: 'cma-text', text: 'Analytics helps me see which pages and projects people use. It counts page views, active time, ' +
        'clicks on links and buttons, errors and page speed. It never reads what you type, uses no cookies, and keeps ' +
        'no ID that follows you between visits.' }),
      el('div', { class: 'cma-field' }, [box, el('label', { for: 'cma-analytics', text: 'Allow usage analytics' })]),
    ];
    if (signal) {
      body.push(el('p', { class: 'cma-text cma-note', role: 'note',
        text: 'Your browser is sending a privacy signal (Global Privacy Control or Do Not Track), so analytics stays off.' }));
    }
    body.push(el('p', { class: 'cma-text' }, [el('a', { href: cfg.privacyUrl, text: 'Read the privacy page' })]));
    body.push(el('div', { class: 'cma-actions' }, [save, cancel]));
    dialog = el('dialog', { class: 'cma-dialog', 'aria-labelledby': 'cma-dialog-title' }, body);
    save.addEventListener('click', safe(function () {
      if (!signal) setChoice(box.checked ? 'granted' : 'denied');
      dialog.close();
    }));
    cancel.addEventListener('click', safe(function () { dialog.close(); }));
    dialog.addEventListener('close', safe(function () {
      dialog.remove();
      dialog = null;
      if (lastOpener && lastOpener.isConnected && lastOpener.focus) lastOpener.focus();
    }));
    d.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    box.focus();
  }

  // Any element with data-cma-preferences opens the dialog (e.g. a footer "Privacy choices" button).
  d.addEventListener('click', safe(function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-cma-preferences]');
    if (t) {
      e.preventDefault();
      openPreferences(t);
    }
  }));

  // ---------------------------------------------------------------------------
  // Tracking
  // ---------------------------------------------------------------------------
  function loadSession() {
    var s = store('session');
    var now = Date.now();
    if (!session && s) {
      try { session = JSON.parse(s.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
    }
    if (!session || typeof session.id !== 'string' || now - session.last > SESSION_IDLE) {
      session = { id: uuid(), seq: 0, last: now, landed: false };
    }
    return session;
  }

  function saveSession() {
    var s = store('session');
    if (s && session) try { s.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }
  }

  function routePath() {
    var p = location.pathname || '/';
    var hash = location.hash || '';
    if (cfg.hashRouting === 'plain' && hash.length > 1) p = '/' + hash.slice(1).split('?')[0].replace(/^\/+/, '');
    else if (cfg.hashRouting && hash.indexOf('#/') === 0) p = hash.slice(1).split('?')[0];
    return p;
  }

  function enqueue(name, props, path) {
    if (state.mode !== 'on') return;
    var s = loadSession();
    s.seq += 1;
    s.last = Date.now();
    var ev = { id: uuid(), n: name, t: Date.now(), path: path || currentPath || routePath(), s: s.id, q: s.seq };
    if (props) ev.props = props;
    if (name === 'page_view' && !s.landed) {
      s.landed = true;
      var ref = referrerHost();
      if (ref) ev.ref = ref;
      try {
        var sp = new URLSearchParams(location.search);
        if (sp.get('utm_source')) {
          ev.us = sp.get('utm_source').slice(0, 40);
          if (sp.get('utm_medium')) ev.um = sp.get('utm_medium').slice(0, 40);
          if (sp.get('utm_campaign')) ev.uc = sp.get('utm_campaign').slice(0, 40);
        }
      } catch (e) { /* ignore */ }
    }
    saveSession();
    queue.push(ev);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (!flushTimer) flushTimer = setTimeout(safe(flush), FLUSH_MS);
  }

  function referrerHost() {
    try {
      if (!d.referrer) return null;
      var h = new URL(d.referrer).hostname;
      return h && h !== location.hostname ? h : null; // host only, never the full URL
    } catch (e) { return null; }
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (state.mode !== 'on' || !queue.length) return;
    while (queue.length) {
      var batch = queue.splice(0, MAX_BATCH);
      var payload = { v: VERSION, p: cfg.project, env: env(), e: batch };
      if (cfg.release) payload.r = cfg.release;
      if (navigator.webdriver) payload.wd = 1;
      send(JSON.stringify(payload), batch);
    }
  }

  function send(body, batch) {
    var url = cfg.endpoint + '/collect';
    var ok = false;
    try {
      // text/plain avoids a CORS preflight; the server parses JSON anyway.
      ok = navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    } catch (e) { ok = false; }
    if (ok) return;
    try {
      fetch(url, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'omit',
                   headers: { 'content-type': 'text/plain' } })
        .catch(function () { requeue(batch); });
    } catch (e) { requeue(batch); }
  }

  // One retry per event; the event id makes a retried duplicate harmless on the server.
  function requeue(batch) {
    batch.forEach(function (ev) {
      if (!ev._retried && state.mode === 'on') {
        ev._retried = true;
        queue.push(ev);
      }
    });
  }

  function pageView() {
    enqueue('page_view', null, currentPath);
  }

  function flushEngagement(path) {
    tick();
    var secs = Math.round(activeMs / 1000);
    activeMs = 0;
    if (secs >= 1) enqueue('engagement', { seconds: Math.min(secs, 1800) }, path);
  }

  function tick() {
    var now = Date.now();
    if (d.visibilityState === 'visible' && now - lastInput < ACTIVE_IDLE) activeMs += Math.min(now - lastTick, 2000);
    lastTick = now;
  }

  function onRoute() {
    var p = routePath();
    if (p === currentPath) return;
    flushEngagement(currentPath);
    currentPath = p;
    pageView();
    setTimeout(safe(observeSections), 300); // let the new view render first
  }

  // Elements marked data-track-view="<slug>" send one section_view per page when scrolled to.
  var sectionsSeen = {};
  var sectionObserver = null;
  function observeSections() {
    if (!w.IntersectionObserver || state.mode !== 'on') return;
    if (sectionObserver) sectionObserver.disconnect();
    sectionObserver = new IntersectionObserver(safe(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var name = en.target.getAttribute('data-track-view');
        var key = currentPath + '|' + name;
        if (name && !sectionsSeen[key]) {
          sectionsSeen[key] = true;
          track('section_view', { section: name });
        }
        sectionObserver.unobserve(en.target);
      });
    }), { rootMargin: '0px 0px -40% 0px' }); // counts once the section's top passes 60% down the screen
    d.querySelectorAll('[data-track-view]').forEach(function (el) { sectionObserver.observe(el); });
  }

  function onInput() { tick(); lastInput = Date.now(); }

  function onHidden() {
    if (d.visibilityState !== 'hidden') { lastTick = Date.now(); return; }
    flushEngagement(currentPath);
    reportVitals();
    flush();
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tagged = t.closest('[data-track]');
    if (tagged) {
      var parts = String(tagged.getAttribute('data-track')).split(':');
      if (parts[0] === 'cta' && parts[1]) track('cta_click', { cta: parts[1] });
      else if (parts[0] === 'feature' && parts[1]) track('feature_use', { feature: parts[1] });
    }
    var a = t.closest('a[href]');
    if (a) {
      var u;
      try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname) {
        track('outbound_click', { target: u.hostname });
        flush(); // the page may be about to unload
      }
    }
  }

  function onError(e) {
    if (errorCount >= MAX_ERRORS) return;
    var props;
    if (e.type === 'unhandledrejection') {
      var r = e.reason;
      props = { kind: 'promise', msg: String((r && r.message) || r || 'unhandled rejection').slice(0, 300) };
    } else if (e.target && e.target !== w && (e.target.src || e.target.href)) {
      props = { kind: 'resource', msg: 'failed to load ' + String(e.target.tagName || 'resource').toLowerCase(),
                src: String(e.target.src || e.target.href).split(/[?#]/)[0] };
    } else {
      props = { kind: 'js', msg: String(e.message || 'script error').slice(0, 300) };
      if (e.filename) props.src = String(e.filename).split(/[?#]/)[0];
      if (e.lineno) props.line = e.lineno;
    }
    var key = props.kind + props.msg + (props.src || '');
    if (errorsSent[key]) return;
    errorsSent[key] = true;
    errorCount += 1;
    track('error', props);
  }

  // Approximate Core Web Vitals (simplified versions of the official definitions).
  function observeVitals() {
    if (!w.PerformanceObserver) return;
    var obs = function (type, cb, opts) {
      try {
        new PerformanceObserver(function (list) { list.getEntries().forEach(safe(cb)); })
          .observe(Object.assign({ type: type, buffered: true }, opts || {}));
      } catch (e) { /* unsupported entry type */ }
    };
    obs('largest-contentful-paint', function (en) { vitals.LCP = en.startTime; });
    obs('layout-shift', function (en) { if (!en.hadRecentInput) vitals.CLS = (vitals.CLS || 0) + en.value; });
    obs('event', function (en) { if (en.interactionId) vitals.INP = Math.max(vitals.INP || 0, en.duration); }, { durationThreshold: 40 });
    obs('paint', function (en) { if (en.name === 'first-contentful-paint') vitals.FCP = en.startTime; });
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.responseStart > 0) vitals.TTFB = nav.responseStart;
    } catch (e) { /* ignore */ }
  }

  var LIMITS = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] };
  function reportVitals() {
    if (vitalsSent) return;
    vitalsSent = true;
    Object.keys(vitals).forEach(function (m) {
      var v = vitals[m];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) return;
      var lim = LIMITS[m];
      var value = m === 'CLS' ? Math.round(v * 1000) / 1000 : Math.round(v);
      track('web_vital', { metric: m, value: value, rating: v <= lim[0] ? 'good' : v <= lim[1] ? 'needs-improvement' : 'poor' });
    });
  }

  var handlers = {
    click: safe(onClick),
    input: safe(onInput),
    hidden: safe(onHidden),
    pagehide: safe(function () { flushEngagement(currentPath); reportVitals(); flush(); }),
    route: safe(onRoute),
    error: safe(onError),
  };
  var tickTimer = null;
  var historyPatched = false;

  function attach() {
    if (listenersOn) return;
    listenersOn = true;
    d.addEventListener('click', handlers.click, true);
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'mousemove'].forEach(function (t) {
      w.addEventListener(t, handlers.input, { passive: true, capture: true });
    });
    d.addEventListener('visibilitychange', handlers.hidden);
    w.addEventListener('pagehide', handlers.pagehide);
    w.addEventListener('popstate', handlers.route);
    if (cfg.hashRouting) w.addEventListener('hashchange', handlers.route);
    w.addEventListener('error', handlers.error, true);
    w.addEventListener('unhandledrejection', handlers.error);
    tickTimer = setInterval(safe(tick), 1000);
    if (!historyPatched) {
      historyPatched = true;
      ['pushState', 'replaceState'].forEach(function (m) {
        var orig = history[m];
        if (typeof orig !== 'function') return;
        history[m] = function () {
          var out = orig.apply(this, arguments);
          if (listenersOn) handlers.route();
          return out;
        };
      });
    }
  }

  function detach() {
    if (!listenersOn) return;
    listenersOn = false;
    d.removeEventListener('click', handlers.click, true);
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'mousemove'].forEach(function (t) {
      w.removeEventListener(t, handlers.input, { capture: true });
    });
    d.removeEventListener('visibilitychange', handlers.hidden);
    w.removeEventListener('pagehide', handlers.pagehide);
    w.removeEventListener('popstate', handlers.route);
    w.removeEventListener('hashchange', handlers.route);
    w.removeEventListener('error', handlers.error, true);
    w.removeEventListener('unhandledrejection', handlers.error);
    clearInterval(tickTimer);
    if (sectionObserver) sectionObserver.disconnect();
  }

  function start() {
    if (state.mode === 'on') return;
    state.mode = 'on';
    state.reason = null;
    currentPath = routePath();
    lastInput = lastTick = Date.now();
    activeMs = 0;
    attach();
    observeVitals();
    pageView();
    observeSections();
  }

  function stop(reason) {
    state.mode = 'off';
    state.reason = reason;
    queue.length = 0;
    clearTimeout(flushTimer);
    flushTimer = null;
    detach();
    session = null;
    var s = store('session');
    if (s) try { s.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  /** Public API for app code: cmAnalytics.track('task_complete', { task: 'quiz' }). */
  function track(name, props) {
    if (state.mode !== 'on' || typeof name !== 'string') return;
    enqueue(name, props && typeof props === 'object' ? props : null, currentPath);
  }

  w.cmAnalytics = {
    version: VERSION,
    track: safe(track),
    openPreferences: safe(function () { openPreferences(); }),
    status: function () { return { mode: state.mode, reason: state.reason }; },
  };

  safe(function () {
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', safe(decide));
    else decide();
  })();
})();
