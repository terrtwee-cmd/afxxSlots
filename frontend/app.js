// =====================================================
// AFXX — CLONE FRONTEND (mobile-first)
// =====================================================

// ---- Splash screen: se oculta cuando la página ya cargó ----
window.addEventListener('load', function () {
  var splash = document.getElementById('splash-screen');
  if (!splash) return;
  setTimeout(function () { splash.classList.add('hidden'); }, 1500);

  // ---- Auto-abrir el modal de Promo Elite ----
  // Se abre SIEMPRE que carga index.html, sin importar cómo llegó aquí:
  //   - Carga directa de la página (primera visita o refresh)
  //   - Después de terminar el registro (register.html → window.location = index.html)
  //   - Después de terminar el login (login.html → window.location = index.html)
  // Se respeta el splash para que no aparezca "montado" encima de la intro.
  setTimeout(function () {
    var elite = document.getElementById('modal-elite-promo');
    if (elite) elite.classList.remove('hidden');
  }, 1700); // un pelito después de que se oculta el splash (1500ms)
});

// ---- Estado (logged out / logged in) ----
function setState(state) {
  const out = document.getElementById('header-out');
  const inn = document.getElementById('header-in');
  if (state === 'out') {
    if (out) out.hidden = false;
    if (inn) inn.hidden = true;
  } else {
    if (out) out.hidden = true;
    if (inn) inn.hidden = false;
  }
}

// ---- Navegación por vistas (Menú / Inicio / Casino / Deportes / Afiliado) ----
// Fuente única de verdad: currentView. El bottom-nav SIEMPRE refleja este valor,
// nunca queda "atorado" en Inicio como pasaba antes.
let currentView = 'home';

function showView(view) {
  currentView = view;
  document.querySelectorAll('.m-view').forEach(v => {
    v.hidden = v.dataset.view !== view;
  });
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelector('.m-views').scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  if (view === 'afiliado') loadReferralStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  // Bottom nav clicks
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
  // Cualquier elemento con data-view-link salta directo a esa vista (y cierra cualquier screen abierto)
  document.querySelectorAll('[data-view-link]').forEach(el => {
    el.addEventListener('click', () => {
      closeAllScreens();
      showView(el.dataset.viewLink);
    });
  });
  // Arranca en Inicio y sincroniza el bottom-nav
  showView('home');

  // El estado real (logged in / logged out) lo decide únicamente refreshSession(),
  // según si existe un token válido guardado. Por defecto, sin token, se ve
  // logged-out — así es como debe comportarse siempre.
  setState('out');
});

// ---- Tabs Casino: Lobby / Originales / Slots ----
document.addEventListener('DOMContentLoaded', () => {
  const casinoTabs = document.getElementById('casino-tabs');
  if (casinoTabs) {
    const lobbyContent = document.getElementById('casino-lobby-content');
    const originalesContent = document.getElementById('casino-originales-content');
    casinoTabs.querySelectorAll('.pill-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        casinoTabs.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        if (lobbyContent) lobbyContent.hidden = (target === 'originales');
        if (originalesContent) originalesContent.hidden = (target !== 'originales');
      });
    });
  }

  // ---- Tabs Afiliado ----
  const afTabs = document.getElementById('afiliado-tabs');
  if (afTabs) {
    afTabs.querySelectorAll('.pill-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        afTabs.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.atab;
        document.querySelectorAll('.a-subview').forEach(sv => {
          sv.hidden = sv.dataset.asub !== target;
        });
        tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      });
    });
  }

  // ---- Flechas de scroll horizontal (Top 10, dividers) ----
  document.querySelectorAll('.row-arrow[data-scroll-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.scrollTarget);
      const inst = el && el.swiper;
      if (inst) { Number(btn.dataset.dir) < 0 ? inst.slidePrev() : inst.slideNext(); }
    });
  });

  // ---- Carruseles reales (Swiper) para Top 10 y las filas de Casino ----
  if (window.Swiper) {
    document.querySelectorAll('.rank-swiper').forEach(el => {
      new Swiper(el, {
        slidesPerView: 'auto',
        spaceBetween: 10,
        freeMode: true,
        grabCursor: true
      });
    });
  }

  // ---- Botones "Invita / Copiar" en toda la app ----
  // Cualquier botón con [data-action="copy-invite"] copia el enlace de
  // invitación configurado por el admin (ver loadInviteLink más abajo).
  // Así el HTML no necesita onclick inline ni el enlace hardcodeado.
  document.querySelectorAll('[data-action="copy-invite"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      copyInviteLink(btn);
    });
  });

  // ---- Banners promocionales del Home: cada uno abre el modal de Promociones ----
  document.querySelectorAll('[data-action="open-promo"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      // Todos los banners llevan al modal de Promociones. Si más adelante quieres
      // diferenciar (ej. el de Elite abre WhatsApp), lo resolvemos por data-promo.
      openModal('promotions');
    });
  });

  // ---- Click en cualquier juego (Casino) ----
  // Sin saldo: recordatorio de depósito. Con saldo: todavía no hay proveedor
  // de juegos conectado, así que se avisa que está en mantenimiento en vez
  // de dejar el clic sin respuesta.
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.game-card');
    if (!card) return;
    e.preventDefault();
    const hasBalance = window.currentUser && Number(window.currentUser.balance) > 0;
    if (!hasBalance) {
      openSoon('Antes de jugar', 'Por favor realice un depósito para jugar.');
    } else {
      openSoon('En mantenimiento', 'Regresa más tarde.');
    }
  });

// ---- Reloj en vivo (pantalla Menú) ----
  if (clock) {
    const tick = () => {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      clock.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    tick();
    setInterval(tick, 1000);
  }
});

// =====================================================
// CONEXIÓN CON EL BACKEND REAL
// =====================================================
// Relativo a propósito: como el backend ahora sirve este mismo frontend
// (ver backend/server.js), '/api' siempre apunta al backend correcto sin
// importar si estás en localhost o detrás de un túnel (cloudflared, ngrok, etc).
const API_BASE = '/api';

function authHeaders() {
  const token = localStorage.getItem('afxx_token');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function applyUserToUI(user) {
  const fmt = n => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headerBalance = document.getElementById('header-balance');
  const mineBalance = document.getElementById('mine-balance');
  const wdBalance = document.getElementById('wd-balance');
  const wdRollover = document.getElementById('wd-rollover');
  if (headerBalance) headerBalance.textContent = fmt(user.balance);
  if (mineBalance) mineBalance.textContent = fmt(user.balance);
  if (wdBalance) wdBalance.textContent = '$' + fmt(user.rolloverRemaining > 0 ? 0 : user.balance);
  if (wdRollover) wdRollover.textContent = '$' + fmt(user.rolloverRemaining);
  window.currentUser = user;
}

// Al cargar cualquier página del "app shell" (index.html), revisa si hay sesión real.
// Si el backend no está corriendo o no hay token, se queda en modo visual (logged-out)
// sin romper nada — así el diseño se sigue pudiendo revisar aunque el backend esté apagado.
async function refreshSession() {
  const token = localStorage.getItem('afxx_token');
  if (!token) { setState('out'); return; }
  try {
    const res = await fetch(API_BASE + '/balance', { headers: authHeaders() });
    if (!res.ok) {
      localStorage.removeItem('afxx_token');
      setState('out');
      return;
    }
    const user = await res.json();
    setState('in');
    applyUserToUI(user);
  } catch (e) {
    // Backend apagado — no truena la vista, solo no hay datos reales.
    console.warn('No se pudo conectar al backend (¿está corriendo?)');
  }
}
document.addEventListener('DOMContentLoaded', refreshSession);

// Carga el enlace de invitación lo antes posible para que esté listo
// cuando el usuario llegue a las pantallas de Afiliado / Menú.
document.addEventListener('DOMContentLoaded', loadInviteLink);

// ---- Deportes: carga dinámica desde el backend (mismo patrón que balance/depósitos) ----
// Ahora mismo el backend responde con datos de ejemplo (ver backend/routes/sports.js).
// En cuanto tengas el endpoint real de tu proveedor de momios, esto se sigue viendo
// igual — solo cambia qué datos entrega el backend.
const TEAM_CREST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15c-3 0-6 1.8-6 4.5C6 21 7.5 22 9 21l3-1.5L15 21c1.5 1 3 0 3-1.5 0-2.7-3-4.5-6-4.5z"/><circle cx="7" cy="10" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="17" cy="10" r="1.6"/></svg>';

async function loadSports() {
  const list = document.getElementById('sports-list');
  if (!list) return;
  try {
    const res = await fetch(API_BASE + '/sports/matches');
    const data = await res.json();
    if (!res.ok || !data.matches || !data.matches.length) {
      list.innerHTML = '<p class="placeholder-block">No hay partidos disponibles en este momento.</p>';
      return;
    }
    list.innerHTML = data.matches.map(m => `
      <div class="match-card">
        <div class="match-header">
          <span class="match-league">${m.league}</span>
          ${m.hot ? '<span class="tag-hot"><img class="ico-inline ico-14" src="assets/icons/icon-hot-flame.png" alt=""/>Caliente</span>' : ''}
        </div>
        <div class="match-teams">
          <div class="team"><div class="team-crest img-placeholder"><span class="ico">${TEAM_CREST_ICON}</span></div><span>${m.teamHome}</span></div>
          <div class="match-time"><div class="time">${m.time}</div><div class="date">${m.date}</div></div>
          <div class="team"><div class="team-crest img-placeholder"><span class="ico">${TEAM_CREST_ICON}</span></div><span>${m.teamAway}</span></div>
        </div>
        <div class="match-odds">
          <button class="odd-btn">1 <span class="odd-val">${m.odds.home}</span></button>
          <button class="odd-btn">Empate <span class="odd-val">${m.odds.draw}</span></button>
          <button class="odd-btn">2 <span class="odd-val">${m.odds.away}</span></button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p class="placeholder-block">No se pudo conectar al backend.</p>';
  }
}
document.addEventListener('DOMContentLoaded', loadSports);

// ---- Depósito real ----
async function confirmDeposit() {
  const token = localStorage.getItem('afxx_token');
  if (!token) { window.location.href = 'login.html'; return; }

  const amountInput = document.getElementById('dep-amount');
  const bonusCheckbox = document.getElementById('dep-bonus');
  const activeMethod = document.querySelector('#dep-methods .pay-method.active');
  const amount = amountInput ? Number(amountInput.value || 0) : 0;
  const method = activeMethod ? activeMethod.querySelector('strong').textContent : 'SPEI';

  try {
    const res = await fetch(API_BASE + '/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ method, amount, bonusAccepted: !!(bonusCheckbox && bonusCheckbox.checked) })
    });
    const data = await res.json();
    if (!res.ok) { openSoon('No se pudo depositar', data.error || 'Error desconocido.'); return; }

    const confirmAmount = document.getElementById('confirm-amount');
    if (confirmAmount) {
      confirmAmount.textContent = Number(data.deposit.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    }
    // Datos de pago reales, configurados por el admin desde el panel (/admin).
    const p = data.payment;
    setCopyField('payment-clabe', 'copy-clabe-btn', p.clabe);
    setCopyField('payment-bank', 'copy-bank-btn', p.bank);
    setCopyField('payment-concept', 'copy-concept-btn', p.concept);
    const beneficiaryEl = document.getElementById('payment-beneficiary');
    if (beneficiaryEl) beneficiaryEl.textContent = p.beneficiary;

    applyUserToUI(data.user);
    openScreen('deposit-confirm');
  } catch (e) {
    openSoon('No se pudo conectar', 'No se pudo conectar al backend. ¿Está corriendo?');
  }
}

// Rellena un valor de la pantalla de pago y conecta su botón "Copiar" a ese valor.
function setCopyField(textId, btnId, value) {
  const textEl = document.getElementById(textId);
  if (textEl) textEl.textContent = value;
  const btn = document.getElementById(btnId);
  if (btn) btn.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(value); };
}

// =====================================================
// ENLACE DE INVITACIÓN (configurado por el admin en /admin)
// Mismo patrón que la Clabe: el admin lo pone en el panel y todos los
// usuarios lo ven. Aquí se carga una vez al abrir la app y se guarda en
// caché para que los botones "Invita" copien al instante, sin un fetch
// cada vez que el usuario toca uno.
// =====================================================
const INVITE_LINK_FALLBACK = 'https://twa.afxx.mx/?ch=1270002';
let inviteLink = INVITE_LINK_FALLBACK;   // valor en caché
let inviteLinkLoaded = false;            // ¿ya lo pedimos al backend?

async function loadInviteLink() {
  try {
    const res = await fetch(API_BASE + '/invite-link');
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.inviteLink === 'string' && data.inviteLink.trim()) {
        inviteLink = data.inviteLink.trim();
      }
    }
  } catch (e) {
    // Si el backend está apagado o falla, nos quedamos con el fallback
    // para que la app no se rompa. El admin puede configurar el real
    // cuando el backend vuelva a estar en línea.
    console.warn('No se pudo cargar el enlace de invitación del backend, usando fallback.');
  }
  inviteLinkLoaded = true;
  // Reflejar el valor en cualquier input/visible de la app que lo muestre.
  const refInput = document.getElementById('invite-link-input');
  if (refInput) refInput.value = inviteLink;
}

// Copia el enlace de invitación al portapapeles. Si todavía no lo cargamos
// del backend, lo carga primero (espera) y luego copia. Muestra un toast
// tipo "¡Copiado!" para que el usuario sepa que pasó.
async function copyInviteLink(btn) {
  if (!inviteLinkLoaded) {
    await loadInviteLink();
  }
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(inviteLink);
      copied = true;
    } else {
      // Fallback para navegadores viejos: input temporal + execCommand
      const tmp = document.createElement('input');
      tmp.value = inviteLink;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.select();
      try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
      document.body.removeChild(tmp);
    }
  } catch (e) {
    copied = false;
  }
  showCopyToast(copied ? '¡Enlace copiado!' : 'No se pudo copiar', copied);
  // Feedback visual en el botón que se tocó (si lo pasaron como argumento)
  if (btn) flashCopyBtn(btn);
}

function flashCopyBtn(btn) {
  const original = btn.textContent;
  btn.textContent = '✓ Copiado';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

// =====================================================
// Cofre de Referidos: barra de progreso + envío de invitados
// para revisión manual del admin (ver routes/invite.js).
// =====================================================
async function loadReferralStatus() {
  const token = localStorage.getItem('afxx_token');
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/referral-status', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    renderReferralStatus(data);
  } catch (e) {
    console.warn('No se pudo cargar el estado de referidos.');
  }
}

function renderReferralStatus(data) {
  const { approved, required, claims } = data;
  const textEl = document.getElementById('referral-progress-text');
  const fillEl = document.getElementById('referral-progress-fill');
  if (textEl) textEl.textContent = `${approved}/${required}`;
  if (fillEl) fillEl.style.width = Math.min(100, (approved / required) * 100) + '%';

  const listEl = document.getElementById('referral-claim-list');
  if (!listEl) return;
  if (!claims || !claims.length) {
    listEl.innerHTML = '';
    return;
  }
  const labels = { pending: 'En revisión', approved: 'Aprobado', rejected: 'No válido' };
  listEl.innerHTML = '<div class="referral-claim-list">' + claims.map(c => `
    <div class="referral-claim-item">
      <span>${c.invitedContact}</span>
      <span class="claim-status ${c.status}">${labels[c.status] || c.status}</span>
    </div>
  `).join('') + '</div>';
}

async function submitReferralClaim() {
  const token = localStorage.getItem('afxx_token');
  if (!token) { window.location.href = 'login.html'; return; }
  const input = document.getElementById('referral-claim-input');
  const msgEl = document.getElementById('referral-claim-msg');
  const invitedContact = input ? input.value.trim() : '';
  if (!invitedContact) {
    if (msgEl) { msgEl.textContent = 'Escribe el ID o contacto de tu invitado.'; msgEl.className = 'err'; }
    return;
  }
  try {
    const res = await fetch(API_BASE + '/referral-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ invitedContact })
    });
    const data = await res.json();
    if (!res.ok) {
      if (msgEl) { msgEl.textContent = data.error || 'No se pudo enviar.'; msgEl.className = 'err'; }
      return;
    }
    if (input) input.value = '';
    if (msgEl) { msgEl.textContent = 'Enviado — en revisión.'; msgEl.className = 'ok'; }
    loadReferralStatus();
  } catch (e) {
    if (msgEl) { msgEl.textContent = 'No se pudo conectar al backend.'; msgEl.className = 'err'; }
  }
}

// Toast genérico reutilizable (éxito / error de copiado).
function showCopyToast(message, ok) {
  let toast = document.getElementById('copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('ok', !!ok);
  toast.classList.toggle('err', !ok);
  toast.classList.add('visible');
  clearTimeout(showCopyToast._t);
  showCopyToast._t = setTimeout(() => {
    toast.classList.remove('visible');
  }, 1800);
}

// ---- Retiro real ----
async function doWithdraw() {
  const token = localStorage.getItem('afxx_token');
  if (!token) { window.location.href = 'login.html'; return; }

  const holder = document.getElementById('wd-holder').value.trim();
  const bank = selectedBank;
  const accountNumber = document.getElementById('wd-account').value.trim();
  const amount = Number(document.getElementById('wd-amount').value || 0);
  const errorEl = document.getElementById('wd-error');
  errorEl.textContent = '';

  if (!holder || !bank || !accountNumber || !amount) {
    errorEl.textContent = 'Completa titular, banco, número de cuenta y monto.';
    return;
  }

  try {
    const res = await fetch(API_BASE + '/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ accountHolder: holder, bank, accountNumber, amount })
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || 'No se pudo procesar el retiro.'; return; }

    applyUserToUI(data.user);
    openSoon('Solicitud enviada', 'Tu retiro quedó pendiente de revisión. Te avisaremos cuando se procese.');
    openScreen('mine');
  } catch (e) {
    errorEl.textContent = 'No se pudo conectar al backend.';
  }
}

function showRolloverInfo() {
  const remaining = window.currentUser ? window.currentUser.rolloverRemaining : 0;
  openSoon('Rollover pendiente', remaining > 0
    ? `Te faltan $${Number(remaining).toFixed(2)} en volumen apostado antes de poder retirar tu saldo con bono.`
    : 'No tienes rollover pendiente — tu saldo es retirable.');
}

// ---- Modales ----
function openModal(id) {
  const m = document.getElementById('modal-' + id);
  if (m) m.classList.remove('hidden');
}
function closeModal(id) {
  const m = document.getElementById('modal-' + id);
  if (m) m.classList.add('hidden');
}
// Modal genérico "próximamente" — usado por todo lo que aún no tiene flujo real
function openSoon(title, text) {
  const t = document.getElementById('soon-title');
  const p = document.getElementById('soon-text');
  if (t) t.textContent = title;
  if (p) p.textContent = text;
  openModal('soon');
}
// Cerrar sesión: borra el token real, vuelve al estado logged-out y regresa a Inicio
function logout() {
  localStorage.removeItem('afxx_token');
  closeAllScreens();
  setState('out');
  showView('home');
}
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
});

// ---- Carrusel automático del banner superior del casino ----
// Cada 5 segundos se desliza hacia la izquierda y muestra el siguiente.
// Como el track tiene 3 slides (A → B → A-clone), el loop es continuo
// sin saltos visibles: al llegar al final "A-clone" se ve igual que "A"
// y el regreso a translateX(0) es invisible.
document.addEventListener('DOMContentLoaded', () => {
  const track = document.querySelector('.casino-top-track');
  if (!track) return;
  const slides = track.querySelectorAll('.casino-top-slide');
  if (slides.length < 2) return;
  let current = 0;
  setInterval(() => {
    current = (current + 1) % slides.length;
    const stepPct = 100 / slides.length;
    track.style.transform = `translateX(-${current * stepPct}%)`;
  }, 5000);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  }
});

// =====================================================
// PANTALLAS DE PANTALLA COMPLETA: Mine / Depósito / Retirar
// (Reemplazan el antiguo drawer lateral con pantallas reales,
// tal como en la captura de referencia: avatar → Mine →
// Depósito → confirmación de pago.)
// =====================================================
function openScreen(id) {
  document.querySelectorAll('.app-screen').forEach(s => { s.hidden = (s.id !== 'screen-' + id); });
  const body = document.querySelector('.phone-shell');
  if (body) body.classList.add('screen-open');
}
function closeAllScreens() {
  document.querySelectorAll('.app-screen').forEach(s => { s.hidden = true; });
  const body = document.querySelector('.phone-shell');
  if (body) body.classList.remove('screen-open');
}

document.addEventListener('DOMContentLoaded', () => {
  const avatarBtn = document.getElementById('open-mine');
  if (avatarBtn) avatarBtn.addEventListener('click', () => {
    if (!localStorage.getItem('afxx_token')) { window.location.href = 'login.html'; return; }
    openScreen('mine');
  });

  // ---- Depósito: selección de método de pago ----
  const methodsRow = document.getElementById('dep-methods');
  const rangeLabel = document.getElementById('dep-range');
  const amountInput = document.getElementById('dep-amount');
  if (methodsRow) {
    methodsRow.querySelectorAll('.pay-method').forEach(btn => {
      btn.addEventListener('click', () => {
        methodsRow.querySelectorAll('.pay-method').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (rangeLabel) {
          const min = Number(btn.dataset.min).toFixed(2);
          const max = Number(btn.dataset.max).toLocaleString('es-MX', { minimumFractionDigits: 2 });
          rangeLabel.textContent = `${min} - ${max} MXN`;
        }
      });
    });
  }

  // ---- Depósito: montos preestablecidos ----
  const presetsRow = document.getElementById('dep-presets');
  if (presetsRow && amountInput) {
    presetsRow.querySelectorAll('.amount-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        presetsRow.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        amountInput.value = chip.dataset.amt;
      });
    });
    amountInput.addEventListener('input', () => {
      presetsRow.querySelectorAll('.amount-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.amt === amountInput.value);
      });
    });
  }

  // ---- Depósito: bono de primer depósito (checkbox muestra/oculta el texto verde) ----
  const bonusCheckbox = document.getElementById('dep-bonus');
  const bonusTag = document.getElementById('bonus-tag');
  if (bonusCheckbox && bonusTag) {
    const syncBonus = () => { bonusTag.hidden = !bonusCheckbox.checked; };
    syncBonus();
    bonusCheckbox.addEventListener('change', syncBonus);
  }

  // ---- Retirar: el monto ya no usa chips, es un solo input (ver campo #wd-amount) ----
});

// =====================================================
// SELECTOR DE BANCO (pantalla Retirar)
// =====================================================
const MEXICAN_BANKS = [
  'STP', 'HSBC', 'AZTECA', 'BANAMEX', 'BANORTE', 'BANREGIO', 'BANCOPPEL', 'SANTANDER',
  'SCOTIABANK', 'BBVA MEXICO', 'Bancomext', 'Inbursa', 'Banco del Bajio', 'ABC CAPITAL',
  'ACTINVER', 'AFIRME', 'NU MEXICO', 'ARCUS', 'ASP INTEGRA OPC', 'AUTOFIN', 'BANCO S3',
  'BANSI', 'BARCLAYS', 'BBASE', 'BMONEX', 'CAJA POP MEXICA', 'CAJA TELEFONIST',
  'CB INTERCAM', 'CI BOLSA', 'CIBANCO', 'COMPARTAMOS', 'CONSUBANCO', 'CREDICAPITAL',
  'CREDIT SUISSE', 'CRISTOBAL COLON', 'CoDi Valida', 'DONDE', 'FINAMEX', 'FINCOMUN',
  'FOMPED', 'FONDO', 'GBM', 'HIPOTECARIA FED', 'ICBC', 'INDEVAL', 'INMOBILIARIO',
  'INTERCAM BANCO', 'INVERCAP', 'INVEX', 'JPMORGAN', 'JeTon', 'KUSPIT', 'LIBERTAD',
  'MASARI', 'MIFEL', 'MIZUHO BANK', 'MONEXCB', 'MUFG', 'MULTIVA CBOLSA', 'MULTIVABANCO',
  'NAFIN', 'PAGATODO', 'PROFUTURO', 'REFORMA', 'SABADELL', 'SHINHAN', 'Spin in OXXO',
  'TRANSFER', 'UNAGRA', 'VALMEX', 'VALUE', 'VECTOR', 'VEPORMAS', 'VOLKSWAGEN'
];
let selectedBank = null;

function renderBankList(filter) {
  const list = document.getElementById('bank-list');
  if (!list) return;
  const q = (filter || '').toLowerCase();
  list.innerHTML = '';
  MEXICAN_BANKS.filter(b => b.toLowerCase().includes(q)).forEach(bank => {
    const row = document.createElement('button');
    row.className = 'bank-row' + (bank === selectedBank ? ' selected' : '');
    row.innerHTML = `<span>${bank}</span>` + (bank === selectedBank ? '<span class="bank-check">✓</span>' : '');
    row.addEventListener('click', () => {
      selectedBank = bank;
      const label = document.getElementById('wd-bank-label');
      if (label) label.textContent = bank;
      closeModal('bank-picker');
    });
    list.appendChild(row);
  });
}
function openBankPicker() {
  renderBankList('');
  const search = document.getElementById('bank-search');
  if (search) search.value = '';
  openModal('bank-picker');
}
document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('bank-search');
  if (search) search.addEventListener('input', () => renderBankList(search.value));
});
