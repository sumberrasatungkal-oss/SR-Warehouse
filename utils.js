import { db } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

export function pad(n){ return n.toString().padStart(2,'0'); }

export function formatDateID(date){
  date = date instanceof Date ? date : new Date(date);
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatTimeID(date){
  date = date instanceof Date ? date : new Date(date);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTimeID(date){
  return `${formatDateID(date)} • ${formatTimeID(date)}`;
}

export function toJsDate(value){
  if (!value) return new Date();
  if (value.toDate) return value.toDate(); // Firestore Timestamp
  return new Date(value);
}

export function startOfToday(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}

export function normalize(str){
  return (str || '').toString().trim().toLowerCase();
}

export function getInitialLetter(name){
  const c = normalize(name).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

export function debounce(fn, delay = 200){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export async function logActivity(uid, userName, action, detail){
  try{
    await addDoc(collection(db, 'activityLogs'), {
      uid, userName, action, detail, timestamp: serverTimestamp()
    });
  }catch(e){
    console.error('Gagal mencatat log aktivitas', e);
  }
}

export function showToast(message, type = 'default'){
  const el = document.getElementById('toast');
  if (!el) return;
  el.removeAttribute('hidden');
  el.textContent = message;
  el.className = 'toast show' + (type !== 'default' ? ' ' + type : '');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

export function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

export function toTitleCase(str){
  return (str || '')
    .split(' ')
    .map(word => word.length ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .join(' ');
}

// Auto-capitalizes the first letter after every space, applied when the
// user leaves the field (so it doesn't fight with the cursor while typing).
export function applyTitleCaseOnBlur(input){
  input.addEventListener('blur', () => {
    input.value = toTitleCase(input.value);
  });
}

export function startOfDate(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  return d;
}

export function endOfDate(date){
  const d = new Date(date);
  d.setHours(23,59,59,999);
  return d;
}

export function isoDateInput(date){
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

