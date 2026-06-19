import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { logActivity } from "./utils.js";

export let currentUser = null; // { uid, email, name, username, role, active }

export const ROLES = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  staff: 'Staff',
  viewer: 'Viewer'
};

export function can(action){
  if (!currentUser) return false;
  const role = currentUser.role;
  const matrix = {
    'items.create': ['admin','supervisor','staff'],
    'items.edit':   ['admin','supervisor'],
    'items.delete': ['admin'],
    'transaction.create': ['admin','supervisor','staff'],
    'transaction.request_correction': ['admin','supervisor','staff'],
    'transaction.approve_correction': ['admin'],
    'manage.users': ['admin'],
    'reports.view': ['admin','supervisor','staff','viewer']
  };
  return (matrix[action] || []).includes(role);
}

export function getThemeClass(role){
  return (role === 'admin' || role === 'supervisor') ? 'theme-admin' : 'theme-staff';
}

export function login(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout(){
  if (currentUser){
    await logActivity(currentUser.uid, currentUser.name, 'logout', `${currentUser.name} keluar dari sistem`);
  }
  return signOut(auth);
}

export async function fetchUserProfile(uid){
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data();
}

/**
 * @param {(user: object) => void} onLogin
 * @param {(errorMessage: string|null) => void} onLogout
 */
export function watchAuthState(onLogin, onLogout){
  onAuthStateChanged(auth, async (user) => {
    if (user){
      let profile;
      try{
        profile = await fetchUserProfile(user.uid);
      }catch(e){
        console.error(e);
        onLogout('Gagal memuat profil pengguna. Coba lagi.');
        return;
      }
      if (!profile){
        await signOut(auth);
        onLogout('Akun ini belum terdaftar di sistem. Hubungi Admin untuk didaftarkan.');
        return;
      }
      if (profile.active === false){
        await signOut(auth);
        onLogout('Akun Anda tidak aktif. Hubungi Admin.');
        return;
      }
      currentUser = { uid: user.uid, email: user.email, ...profile };
      logActivity(currentUser.uid, currentUser.name, 'login', `${currentUser.name} masuk ke sistem`);
      onLogin(currentUser);
    } else {
      currentUser = null;
      onLogout(null);
    }
  });
}

// Dipakai Admin untuk mendaftarkan role bagi user yang sudah dibuat
// secara manual di Firebase Console > Authentication.
export async function registerUserRole(uid, { username, name, role }){
  await setDoc(doc(db, 'users', uid), {
    username, name, role, active: true, createdAt: serverTimestamp()
  });
}
