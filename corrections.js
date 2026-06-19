import { db } from "./firebase-init.js";
import {
  collection, addDoc, query, where, onSnapshot, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { currentUser, can } from "./auth.js";
import { adjustStock, itemsCache } from "./items.js";
import { logActivity, showToast, escapeHtml, formatDateTimeID } from "./utils.js";

export let myCorrections = [];
export let pendingCorrections = [];

let unsubMine = null, unsubPending = null;
let mineListeners = [], pendingListeners = [];

export function startMyCorrectionsListener(){
  if (unsubMine || !currentUser) return;
  const q = query(collection(db, 'correctionRequests'), where('requestedBy', '==', currentUser.uid));
  unsubMine = onSnapshot(q, snap => {
    myCorrections = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.timestamp?.toMillis()||0) - (a.timestamp?.toMillis()||0));
    mineListeners.forEach(fn => fn(myCorrections));
  }, (err) => console.error('myCorrections listener error', err));
}
export function onMyCorrectionsChange(fn){ mineListeners.push(fn); }

export function getCorrectionStatusForTx(txId){
  const c = myCorrections.find(c => c.originalTxId === txId);
  return c ? c.status : null;
}

export function startPendingCorrectionsListener(){
  if (unsubPending || !can('transaction.approve_correction')) return;
  const q = query(collection(db, 'correctionRequests'), where('status', '==', 'pending'));
  unsubPending = onSnapshot(q, snap => {
    pendingCorrections = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.timestamp?.toMillis()||0) - (a.timestamp?.toMillis()||0));
    pendingListeners.forEach(fn => fn(pendingCorrections));
  }, (err) => console.error('pendingCorrections listener error', err));
}
export function onPendingCorrectionsChange(fn){ pendingListeners.push(fn); }

export async function requestCorrection(tx, { actionType, proposedQty, proposedStokFisik, reason }){
  if (!reason || !reason.trim()) throw new Error('Alasan wajib diisi.');
  await addDoc(collection(db, 'correctionRequests'), {
    originalTxId: tx.id,
    originalType: tx.type,
    itemId: tx.itemId, itemName: tx.itemName, unit: tx.unit,
    originalQty: tx.qty ?? null,
    originalStokSistem: tx.stokSistem ?? null,
    originalStokFisik: tx.stokFisik ?? null,
    actionType,
    proposedQty: proposedQty ?? null,
    proposedStokFisik: proposedStokFisik ?? null,
    reason: reason.trim(),
    requestedBy: currentUser.uid, requestedByName: currentUser.name,
    status: 'pending', timestamp: serverTimestamp()
  });
  await logActivity(currentUser.uid, currentUser.name, 'ajukan_koreksi',
    `${currentUser.name} mengajukan ${actionType === 'cancel' ? 'pembatalan' : 'revisi'} transaksi ${tx.itemName}`);
}

export async function approveCorrection(c){
  if (!can('transaction.approve_correction')) throw new Error('Tidak punya izin menyetujui.');

  if (c.actionType === 'cancel'){
    if (c.originalType === 'masuk') await adjustStock(c.itemId, -c.originalQty, 'delta');
    if (c.originalType === 'keluar') await adjustStock(c.itemId, c.originalQty, 'delta');
    if (c.originalType === 'opname') await adjustStock(c.itemId, c.originalStokSistem, 'set');
    await updateDoc(doc(db, 'transactions', c.originalTxId), {
      status: 'dibatalkan', cancelledBy: currentUser.name, cancelledAt: serverTimestamp()
    });
  } else if (c.actionType === 'revise'){
    if (c.originalType === 'masuk'){
      await adjustStock(c.itemId, c.proposedQty - c.originalQty, 'delta');
      await updateDoc(doc(db, 'transactions', c.originalTxId), {
        qty: c.proposedQty, status: 'direvisi', revisedBy: currentUser.name, revisedAt: serverTimestamp()
      });
    } else if (c.originalType === 'keluar'){
      await adjustStock(c.itemId, -(c.proposedQty - c.originalQty), 'delta');
      await updateDoc(doc(db, 'transactions', c.originalTxId), {
        qty: c.proposedQty, status: 'direvisi', revisedBy: currentUser.name, revisedAt: serverTimestamp()
      });
    } else if (c.originalType === 'opname'){
      await adjustStock(c.itemId, c.proposedStokFisik, 'set');
      const selisih = c.proposedStokFisik - c.originalStokSistem;
      await updateDoc(doc(db, 'transactions', c.originalTxId), {
        stokFisik: c.proposedStokFisik, selisih, status: 'direvisi', revisedBy: currentUser.name, revisedAt: serverTimestamp()
      });
    }
  }

  await updateDoc(doc(db, 'correctionRequests', c.id), {
    status: 'approved', reviewedBy: currentUser.uid, reviewedByName: currentUser.name, reviewedAt: serverTimestamp()
  });
  await logActivity(currentUser.uid, currentUser.name, 'setujui_koreksi',
    `${currentUser.name} menyetujui ${c.actionType === 'cancel' ? 'pembatalan' : 'revisi'} ${c.itemName}`);
}

export async function rejectCorrection(c, note){
  if (!can('transaction.approve_correction')) throw new Error('Tidak punya izin menolak.');
  await updateDoc(doc(db, 'correctionRequests', c.id), {
    status: 'rejected', reviewNote: note || '', reviewedBy: currentUser.uid, reviewedByName: currentUser.name, reviewedAt: serverTimestamp()
  });
  await logActivity(currentUser.uid, currentUser.name, 'tolak_koreksi', `${currentUser.name} menolak permintaan koreksi ${c.itemName}`);
}

/* ===================== UI ===================== */

export function openCorrectionModal(tx){
  const root = document.getElementById('modal-root');
  const isOpname = tx.type === 'opname';
  root.innerHTML = `
    <div class="modal-overlay" id="cc-modal-overlay">
      <div class="modal-box">
        <div class="modal-header">
          <h3>Ajukan Revisi / Pembatalan</h3>
          <button class="btn-icon" id="cc-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p class="form-hint">Barang: <strong>${escapeHtml(tx.itemName)}</strong></p>
          <div class="form-grid">
            <label class="field full">
              <span>Jenis Permintaan</span>
              <select id="cc-action">
                <option value="cancel">Batalkan transaksi ini</option>
                <option value="revise">Revisi jumlah</option>
              </select>
            </label>
            <label class="field full" id="cc-revise-field" style="display:none">
              <span>${isOpname ? 'Stok Fisik yang Benar' : 'Jumlah yang Benar'}</span>
              <input type="number" id="cc-new-value" min="0" value="${isOpname ? (tx.stokFisik ?? '') : (tx.qty ?? '')}">
            </label>
            <label class="field full">
              <span>Alasan</span>
              <textarea id="cc-reason" rows="3" placeholder="Contoh: salah input jumlah, barang dikembalikan, dll."></textarea>
            </label>
          </div>
          <p class="form-error" id="cc-error" hidden></p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="cc-cancel">Batal</button>
          <button class="btn btn-accent" id="cc-submit">Ajukan ke Admin</button>
        </div>
      </div>
    </div>
  `;
  const overlay = root.querySelector('#cc-modal-overlay');
  const close = () => { root.innerHTML = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.querySelector('#cc-modal-close').addEventListener('click', close);
  root.querySelector('#cc-cancel').addEventListener('click', close);

  const actionSelect = root.querySelector('#cc-action');
  const reviseField = root.querySelector('#cc-revise-field');
  actionSelect.addEventListener('change', () => {
    reviseField.style.display = actionSelect.value === 'revise' ? 'block' : 'none';
  });

  root.querySelector('#cc-submit').addEventListener('click', async () => {
    const errorEl = root.querySelector('#cc-error');
    errorEl.hidden = true;
    const actionType = actionSelect.value;
    const reason = root.querySelector('#cc-reason').value;
    try{
      const payload = { actionType, reason };
      if (actionType === 'revise'){
        const val = Number(root.querySelector('#cc-new-value').value);
        if (isOpname) payload.proposedStokFisik = val; else payload.proposedQty = val;
      }
      await requestCorrection(tx, payload);
      showToast('Permintaan terkirim, menunggu persetujuan Admin', 'success');
      close();
    }catch(e){
      errorEl.textContent = e.message || 'Gagal mengirim permintaan.';
      errorEl.hidden = false;
    }
  });
}

export function mountApprovals(container){
  startPendingCorrectionsListener();

  function render(){
    if (pendingCorrections.length === 0){
      container.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state">Tidak ada permintaan revisi/pembatalan yang menunggu persetujuan.</div></div></div>`;
      return;
    }
    container.innerHTML = pendingCorrections.map(c => correctionCardHtml(c)).join('');
    container.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const c = pendingCorrections.find(x => x.id === btn.dataset.approve);
        btn.disabled = true;
        try{
          await approveCorrection(c);
          showToast('Disetujui, stok telah diperbarui', 'success');
        }catch(e){ showToast(e.message || 'Gagal menyetujui', 'error'); }
      });
    });
    container.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const c = pendingCorrections.find(x => x.id === btn.dataset.reject);
        const note = prompt('Alasan menolak (opsional):') || '';
        btn.disabled = true;
        try{
          await rejectCorrection(c, note);
          showToast('Permintaan ditolak', 'default');
        }catch(e){ showToast(e.message || 'Gagal menolak', 'error'); }
      });
    });
  }

  render();
  onPendingCorrectionsChange(render);
}

function correctionCardHtml(c){
  const d = c.timestamp?.toDate ? c.timestamp.toDate() : new Date();
  const detail = c.actionType === 'cancel'
    ? `Membatalkan transaksi ${c.originalType}`
    : `Revisi ${c.originalType === 'opname' ? 'stok fisik' : 'jumlah'} menjadi ${c.originalType === 'opname' ? c.proposedStokFisik : c.proposedQty} ${escapeHtml(c.unit||'')}`;
  return `
    <div class="correction-card">
      <div class="cc-head">
        <span>${escapeHtml(c.itemName)}</span>
        <span class="tx-status-pill pending">Pending</span>
      </div>
      <div class="cc-reason">${detail} • diajukan oleh ${escapeHtml(c.requestedByName)} • ${formatDateTimeID(d)}</div>
      <div class="cc-reason">Alasan: ${escapeHtml(c.reason)}</div>
      <div class="cc-actions">
        <button class="btn btn-primary btn-sm" data-approve="${c.id}">Setujui</button>
        <button class="btn btn-danger btn-sm" data-reject="${c.id}">Tolak</button>
      </div>
    </div>
  `;
}
