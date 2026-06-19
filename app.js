import { login, logout, watchAuthState, can, ROLES, getThemeClass } from "./auth.js";
import { startItemsListener, mountMasterData } from "./items.js";
import { startTodayTransactionsListener, mountTransaksi } from "./transactions.js";
import { mountDashboard } from "./dashboard.js";
import { mountReports } from "./reports.js";
import { mountApprovals } from "./corrections.js";
import { mountUserAdmin } from "./users-admin.js";

const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginSubmit = document.getElementById('login-submit');

const sidebarNav = document.getElementById('sidebar-nav');
const bottomNav = document.getElementById('bottom-nav');
const screenTitle = document.getElementById('screen-title');
const userNameEl = document.getElementById('user-name');
const userRoleEl = document.getElementById('user-role');
const userAvatarEl = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');
const sidebar = document.querySelector('.sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const topbarClock = document.getElementById('topbar-clock');

const MENU = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'master-data', label: 'Master Data Barang', icon: '📦' },
  { key: 'transaksi', label: 'Transaksi Stok', icon: '🔄', requires: 'transaction.create' },
  { key: 'laporan', label: 'Laporan', icon: '📑' },
  { key: 'persetujuan', label: 'Persetujuan', icon: '✅', requires: 'transaction.approve_correction' },
  { key: 'kelola-user', label: 'Kelola User', icon: '👥', requires: 'manage.users' }
];

let dataListenersStarted = false;

/* ---------- Password visibility toggle ---------- */
const pwInput = document.getElementById('login-password');
const pwToggle = document.getElementById('login-password-toggle');
pwToggle.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  pwToggle.textContent = show ? '🙈' : '👁';
});

/* ---------- Login form ---------- */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Memproses...';
  const email = document.getElementById('login-email').value.trim();
  const password = pwInput.value;
  try{
    await login(email, password);
  }catch(err){
    console.error(err);
    loginError.textContent = mapAuthError(err.code);
    loginError.hidden = false;
  }finally{
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Masuk';
  }
});

function mapAuthError(code){
  switch(code){
    case 'auth/invalid-email': return 'Format email tidak valid.';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return 'Email atau password salah.';
    case 'auth/too-many-requests': return 'Terlalu banyak percobaan gagal. Coba lagi nanti.';
    default: return 'Gagal masuk. Periksa koneksi internet Anda.';
  }
}

logoutBtn.addEventListener('click', () => logout());

/* ---------- Mobile sidebar open/close ---------- */
function openSidebar(){
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('show');
}
function closeSidebar(){
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('show');
}
mobileMenuBtn?.addEventListener('click', openSidebar);
sidebarCloseBtn?.addEventListener('click', closeSidebar);
sidebarBackdrop?.addEventListener('click', closeSidebar);

/* ---------- Auth state ---------- */
watchAuthState(
  (user) => {
    loginScreen.hidden = true;
    appShell.hidden = false;

    document.body.classList.remove('theme-admin', 'theme-staff');
    document.body.classList.add(getThemeClass(user.role));

    userNameEl.textContent = user.name || user.username || user.email;
    userRoleEl.textContent = ROLES[user.role] || user.role;
    userAvatarEl.textContent = (user.name || user.username || '?').charAt(0).toUpperCase();

    renderNav();
    if (!dataListenersStarted){
      startItemsListener();
      startTodayTransactionsListener();
      dataListenersStarted = true;
    }
    switchScreen('dashboard');
  },
  (errorMessage) => {
    appShell.hidden = true;
    loginScreen.hidden = false;
    if (errorMessage){
      loginError.textContent = errorMessage;
      loginError.hidden = false;
    }
  }
);

/* ---------- Navigation ---------- */
function renderNav(){
  const items = MENU.filter(m => !m.requires || can(m.requires));
  const navHtml = items.map(m => `
    <button class="nav-item" data-screen="${m.key}">
      <span class="nav-icon">${m.icon}</span><span>${m.label}</span>
    </button>
  `).join('');
  sidebarNav.innerHTML = navHtml;
  bottomNav.innerHTML = items.map(m => `
    <button class="nav-item" data-screen="${m.key}">
      <span class="nav-icon">${m.icon}</span><span>${m.label.split(' ')[0]}</span>
    </button>
  `).join('');

  document.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchScreen(btn.dataset.screen);
      closeSidebar();
    });
  });
}

const screenTitles = {
  'dashboard': 'Dashboard',
  'master-data': 'Master Data Barang',
  'transaksi': 'Transaksi Stok',
  'laporan': 'Laporan',
  'persetujuan': 'Persetujuan Revisi/Pembatalan',
  'kelola-user': 'Kelola User'
};

const mountedScreens = new Set();

function switchScreen(key){
  screenTitle.textContent = screenTitles[key] || '';

  document.querySelectorAll('.screen-panel').forEach(panel => panel.hidden = true);
  document.querySelectorAll('[data-screen]').forEach(btn => btn.classList.toggle('active', btn.dataset.screen === key));

  const panel = document.getElementById(`screen-${key}`);
  if (!panel) return;
  panel.hidden = false;

  // Mount once; underlying modules keep themselves in sync via onChange listeners.
  if (!mountedScreens.has(key)){
    if (key === 'dashboard') mountDashboard(panel);
    if (key === 'master-data') mountMasterData(panel);
    if (key === 'transaksi') mountTransaksi(panel);
    if (key === 'laporan') mountReports(panel);
    if (key === 'persetujuan') mountApprovals(panel);
    if (key === 'kelola-user') mountUserAdmin(panel);
    mountedScreens.add(key);
  }
}

/* ---------- Clock ---------- */
function tickClock(){
  const now = new Date();
  topbarClock.textContent = now.toLocaleString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
tickClock();
setInterval(tickClock, 1000);
