import { db, createSecondaryAuth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth } from "./firebase-init.js";
import { currentUser, can, ROLES } from "./auth.js";
import { logActivity, showToast, escapeHtml, applyTitleCaseOnBlur } from "./utils.js";

export let usersCache = [];
let unsubUsers = null;
let listeners = [];

export function startUsersListener(){
  if (unsubUsers || !can('manage.users')) return;
  const q = query(collection(db, 'users'), orderBy('name'));
  unsubUsers = onSnapshot(q, snap => {
    usersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    listeners.forEach(fn => fn(usersCache));
  }, (err) => console.error('users listener error', err));
}
function onUsersChange(fn){ listeners.push(fn); }

export async function addEmployee({ email, password, name, username, role }){
  const { auth: secAuth, cleanup } = createSecondaryAuth();
  try{
    const cred = await createUserWithEmailAndPassword(secAuth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username, name, role, email, active: true,
      createdAt: serverTimestamp(), createdBy: currentUser.name
    });
    await signOut(secAuth);
    await logActivity(currentUser.uid, currentUser.name, 'tambah_user', `${currentUser.name} menambahkan akun baru: ${name} (${role})`);
  } finally {
    cleanup();
  }
}

export async function setUserActive(uid, name, active){
  await updateDoc(doc(db, 'users', uid), { active });
  await logActivity(currentUser.uid, currentUser.name, active ? 'aktifkan_user' : 'nonaktifkan_user', `${currentUser.name} ${active?'mengaktifkan':'menonaktifkan'} akun ${name}`);
}

export async function removeUserProfile(uid, name){
  await deleteDoc(doc(db, 'users', uid));
  await logActivity(currentUser.uid, currentUser.name, 'hapus_user', `${currentUser.name} menghapus profil akun ${name} dari sistem`);
}

export async function sendResetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

/* ===================== UI ===================== */

export function mountUserAdmin(container){
  if (!can('manage.users')){
    container.innerHTML = `<div class="empty-state">Hanya Admin yang dapat mengelola user.</div>`;
    return;
  }
  startUsersListener();

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Daftar User</h3>
        <button class="btn btn-accent btn-sm" id="ua-add-btn">+ Tambah Karyawan</button>
      </div>
      <div class="card-body" id="ua-list"></div>
    </div>
  `;

  function render(){
    const list = container.querySelector('#ua-list');
    if (!usersCache.length){
      list.innerHTML = `<div class="empty-state">Belum ada user.</div>`;
      return;
    }
    list.innerHTML = usersCache.map(userRowHtml).join('');
    list.querySelectorAll('[data-toggle-active]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = usersCache.find(x => x.uid === btn.dataset.toggleActive);
        btn.disabled = true;
        try{
          await setUserActive(u.uid, u.name, !(u.active !== false));
          showToast('Status user diperbarui', 'success');
        }catch(e){ showToast('Gagal mengubah status', 'error'); }
      });
    });
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = usersCache.find(x => x.uid === btn.dataset.remove);
        if (!confirm(`Hapus profil "${u.name}" dari sistem? Akun ini tidak akan bisa login lagi (perlu didaftarkan ulang kalau ingin aktif lagi).`)) return;
        try{
          await removeUserProfile(u.uid, u.name);
          showToast('Profil user dihapus', 'success');
        }catch(e){ showToast('Gagal menghapus', 'error'); }
      });
    });
    list.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = usersCache.find(x => x.uid === btn.dataset.reset);
        if (!u.email){ showToast('User ini tidak punya email tersimpan di sistem.', 'error'); return; }
        try{
          await sendResetPassword(u.email);
          showToast(`Link reset password dikirim ke ${u.email}`, 'success');
        }catch(e){ showToast('Gagal mengirim, pastikan email valid & aktif.', 'error'); }
      });
    });
  }

  render();
  onUsersChange(render);

  container.querySelector('#ua-add-btn').addEventListener('click', openAddEmployeeModal);
}

function userRowHtml(u){
  const isActive = u.active !== false;
  return `
    <div class="user-row">
      <div class="u-info">
        <strong>${escapeHtml(u.name)} ${u.uid === currentUser.uid ? '(Anda)' : ''}</strong>
        <span>${escapeHtml(u.username||'')} ${u.email ? '• '+escapeHtml(u.email) : ''}</span>
        <span class="role-pill ${isActive?'':'inactive'}">${ROLES[u.role]||u.role}${isActive?'':' • nonaktif'}</span>
      </div>
      ${u.uid === currentUser.uid ? '' : `
      <div class="u-actions">
        <button class="btn btn-ghost btn-sm" data-reset="${u.uid}">Reset Password</button>
        <button class="btn btn-ghost btn-sm" data-toggle-active="${u.uid}">${isActive?'Nonaktifkan':'Aktifkan'}</button>
        <button class="btn btn-danger btn-sm" data-remove="${u.uid}">Hapus</button>
      </div>`}
    </div>
  `;
}

function openAddEmployeeModal(){
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="ua-modal-overlay">
      <div class="modal-box">
        <div class="modal-header">
          <h3>Tambah Karyawan</h3>
          <button class="btn-icon" id="ua-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <label class="field full"><span>Nama Lengkap</span><input type="text" id="ua-name"></label>
            <label class="field full"><span>Username</span><input type="text" id="ua-username" placeholder="staff1"></label>
            <label class="field full"><span>Email Login</span><input type="email" id="ua-email" placeholder="staff1@sumberrasatungkal.id atau email asli"></label>
            <label class="field full"><span>Password Awal</span><input type="password" id="ua-password" placeholder="min. 6 karakter"></label>
            <label class="field full">
              <span>Role</span>
              <select id="ua-role">
                <option value="staff">Staff</option>
                <option value="supervisor">Supervisor</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <p class="form-hint">Tips: kalau ingin fitur "Reset Password" bisa dipakai nanti, gunakan email asli (boleh Gmail pribadi karyawan) — bukan email palsu.</p>
          <p class="form-error" id="ua-error" hidden></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="ua-cancel">Batal</button>
          <button class="btn btn-primary" id="ua-save">Simpan</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#ua-modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'ua-modal-overlay') close(); });
  root.querySelector('#ua-modal-close').addEventListener('click', close);
  root.querySelector('#ua-cancel').addEventListener('click', close);
  applyTitleCaseOnBlur(root.querySelector('#ua-name'));

  root.querySelector('#ua-save').addEventListener('click', async () => {
    const errorEl = root.querySelector('#ua-error');
    errorEl.hidden = true;
    const name = root.querySelector('#ua-name').value.trim();
    const username = root.querySelector('#ua-username').value.trim();
    const email = root.querySelector('#ua-email').value.trim();
    const password = root.querySelector('#ua-password').value;
    const role = root.querySelector('#ua-role').value;

    if (!name || !username || !email || !password){ errorEl.textContent = 'Semua field wajib diisi.'; errorEl.hidden = false; return; }
    if (password.length < 6){ errorEl.textContent = 'Password minimal 6 karakter.'; errorEl.hidden = false; return; }

    const saveBtn = root.querySelector('#ua-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan...';
    try{
      await addEmployee({ email, password, name, username, role });
      showToast('Karyawan baru berhasil ditambahkan', 'success');
      close();
    }catch(e){
      console.error(e);
      errorEl.textContent = e.code === 'auth/email-already-in-use' ? 'Email ini sudah terdaftar.' : 'Gagal menambahkan. Coba lagi.';
      errorEl.hidden = false;
      saveBtn.disabled = false; saveBtn.textContent = 'Simpan';
    }
  });
}
