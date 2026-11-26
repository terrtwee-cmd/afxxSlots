/* =====================================================================
   AFXX · Motor de tema claro / oscuro
   ---------------------------------------------------------------------
   Compartido por index.html, login.html, register.html y el panel de
   admin (backend/public/index.html).

   - Guarda la preferencia en localStorage (afxx_theme).
   - En la PRIMERA visita abre un selector de tema (solo esa vez).
   - Aplica el tema antes del primer pintado (anti-parpadeo) mediante un
     script inline que cada pagina carga en el <head>.
   - Expone botones de cambio rapido con [data-theme-toggle].
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'afxx_theme';        // 'dark' | 'light'
  var ASKED_KEY = 'afxx_theme_asked'; // marca de "ya eligio una vez"
  var DEFAULT_THEME = 'dark';

  var readyCbs = [];
  var isReady = false;

  /* ---------------- almacenamiento ---------------- */
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* modo privado */ }
  }

  function normalize(theme) {
    return (theme === 'light' || theme === 'dark') ? theme : DEFAULT_THEME;
  }

  /* ---------------- API publica ---------------- */
  function get() { return normalize(read(KEY)); }

  function apply(theme, persist) {
    theme = normalize(theme);
    var root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.setAttribute('data-theme', 'light');
    if (persist !== false) write(KEY, theme);
    renderToggles();
    return theme;
  }

  function set(theme) {
    apply(theme, true);
    markAsked();
    return get();
  }

  function toggle() {
    return set(get() === 'dark' ? 'light' : 'dark');
  }

  function needsChoice() { return !read(ASKED_KEY); }
  function markAsked() { write(ASKED_KEY, '1'); }

  function onReady(cb) {
    if (typeof cb !== 'function') return;
    if (isReady) cb();
    else readyCbs.push(cb);
  }

  function flushReady() {
    if (isReady) return;
    isReady = true;
    var cbs = readyCbs.slice();
    readyCbs.length = 0;
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](); } catch (e) { /* no romper la pagina */ }
    }
  }

  /* ---------------- iconos ---------------- */
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';

  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"></path></svg>';

  /* ---------------- estilos del selector ----------------
     Se inyectan desde aqui para que el bloque funcione igual en las
     paginas publicas (que usan styles.css) y en el panel de admin
     (que trae sus propios estilos inline). */
  var CSS = [
    '.theme-picker-overlay{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;',
    'justify-content:center;padding:20px;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);',
    '-webkit-backdrop-filter:blur(6px);animation:afxx-theme-fade .25s ease}',
    '@keyframes afxx-theme-fade{from{opacity:0}to{opacity:1}}',
    '.theme-picker{width:100%;max-width:360px;background:var(--bg-card,#fff);',
    'border:1px solid var(--border,#e5e7eb);border-radius:18px;padding:22px;',
    'box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:var(--font-body,-apple-system,Segoe UI,Roboto,sans-serif);',
    'color:var(--text-primary,#111);text-align:center}',
    '.theme-picker-logo{width:58px;height:58px;margin:0 auto 12px;border-radius:16px;display:flex;',
    'align-items:center;justify-content:center;background:linear-gradient(135deg,#DD0201,#9F0201);',
    'box-shadow:0 8px 22px rgba(221,2,1,.35)}',
    '.theme-picker-logo svg{width:30px;height:30px;color:#fff}',
    '.theme-picker h2{margin:0 0 4px;font-size:17px;font-weight:800}',
    '.theme-picker p{margin:0 0 18px;font-size:12.5px;line-height:1.45;',
    'color:var(--text-secondary,#6b7280)}',
    '.theme-picker-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}',
    '.theme-option{background:var(--bg-card-2,#f7f7f8);border:1.5px solid var(--border,#e5e7eb);',
    'border-radius:14px;padding:14px 8px;cursor:pointer;display:flex;flex-direction:column;',
    'align-items:center;gap:7px;font:inherit;color:var(--text-primary,#111);transition:all .18s ease}',
    '.theme-option:hover{border-color:var(--red,#DD0201)}',
    '.theme-option.selected{border-color:var(--red,#DD0201);background:var(--red-tint-3,#FDECEC);',
    'box-shadow:0 0 0 3px var(--red-glow,rgba(221,2,1,.25))}',
    '.theme-option svg{width:26px;height:26px;color:var(--text-secondary,#6b7280)}',
    '.theme-option.selected svg{color:var(--red,#DD0201)}',
    '.theme-option b{font-size:13px;font-weight:800}',
    '.theme-option small{font-size:10.5px;color:var(--text-muted,#9ca3af);font-weight:600}',
    '.theme-picker-cta{width:100%;height:46px;border:none;border-radius:12px;cursor:pointer;',
    'background:var(--red,#DD0201);color:#fff;font:inherit;font-weight:800;font-size:14px;',
    'box-shadow:0 4px 16px rgba(225,29,72,.28)}',
    '.theme-picker-cta:active{transform:translateY(1px)}',
    /* boton de cambio rapido */
    '.theme-toggle{width:34px;height:34px;flex:0 0 auto;border-radius:50%;display:inline-flex;',
    'align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--border,#e5e7eb);',
    'background:var(--bg-card-2,#f7f7f8);color:var(--text-secondary,#6b7280);transition:all .18s ease}',
    '.theme-toggle:hover{color:var(--red,#DD0201);border-color:var(--red,#DD0201)}',
    '.theme-toggle svg{width:17px;height:17px}',
    '.theme-toggle:focus-visible{outline:2px solid var(--red,#DD0201);outline-offset:2px}'
  ].join('');

  function injectStyles() {
    if (document.getElementById('afxx-theme-style')) return;
    var style = document.createElement('style');
    style.id = 'afxx-theme-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------------- boton de cambio rapido ---------------- */
  function renderToggles() {
    var theme = get();
    var nodes = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < nodes.length; i++) {
      var btn = nodes[i];
      btn.innerHTML = (theme === 'dark' ? ICON_SUN : ICON_MOON);
      btn.setAttribute('title', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      btn.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }
  }

  function bindToggles() {
    var nodes = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function () { toggle(); });
    }
  }

  /* ---------------- selector de primera visita ---------------- */
  function buildPicker(selected) {
    var overlay = document.createElement('div');
    overlay.className = 'theme-picker-overlay';
    overlay.id = 'theme-picker-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Elige el modo de color');

    overlay.innerHTML =
      '<div class="theme-picker">' +
      '<div class="theme-picker-logo">' + ICON_MOON + '</div>' +
      '<h2>Elige tu modo</h2>' +
      '<p>Puedes cambiarlo cuando quieras desde el boton de la barra superior.</p>' +
      '<div class="theme-picker-options">' +
      '<button type="button" class="theme-option" data-theme-choice="light">' +
      ICON_SUN + '<b>Claro</b><small>Tema original</small></button>' +
      '<button type="button" class="theme-option" data-theme-choice="dark">' +
      ICON_MOON + '<b>Oscuro</b><small>Recomendado</small></button>' +
      '</div>' +
      '<button type="button" class="theme-picker-cta" data-theme-confirm>Continuar</button>' +
      '</div>';

    document.body.appendChild(overlay);

    var choice = selected;

    function paint() {
      var opts = overlay.querySelectorAll('[data-theme-choice]');
      for (var i = 0; i < opts.length; i++) {
        var isSel = opts[i].getAttribute('data-theme-choice') === choice;
        opts[i].classList.toggle('selected', isSel);
        opts[i].setAttribute('aria-pressed', isSel ? 'true' : 'false');
      }
      // vista previa inmediata
      apply(choice, false);
    }

    overlay.addEventListener('click', function (ev) {
      var opt = ev.target.closest ? ev.target.closest('[data-theme-choice]') : null;
      if (opt) {
        choice = opt.getAttribute('data-theme-choice');
        paint();
        return;
      }
      if (ev.target.closest && ev.target.closest('[data-theme-confirm]')) {
        set(choice);
        close();
      }
    });

    // Enter / Espacio tambien confirman con la opcion enfocada.
    overlay.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        set(choice);
        close();
      }
    });

    function close() {
      markAsked();
      overlay.parentNode.removeChild(overlay);
      document.documentElement.classList.remove('theme-picker-pending');
      flushReady();
    }

    paint();
    var first = overlay.querySelector('[data-theme-choice="' + choice + '"]');
    if (first) first.focus();
    return overlay;
  }

  /* ---------------- arranque ---------------- */
  function init() {
    injectStyles();
    apply(get(), false);   // asegura data-theme consistente
    bindToggles();
    renderToggles();

    if (needsChoice()) {
      // la pagina se queda "en espera" (splash oculto) hasta que elija
      document.documentElement.classList.add('theme-picker-pending');
      buildPicker(get());
      // si el usuario nunca elige (pestana cerrada), la pagina no se queda
      // bloqueada para siempre en la proxima visita
    } else {
      flushReady();
    }
  }

  window.AFXXTheme = {
    get: get,
    set: set,
    toggle: toggle,
    apply: apply,
    needsChoice: needsChoice,
    markAsked: markAsked,
    onReady: onReady,
    isReady: function () { return isReady; },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
