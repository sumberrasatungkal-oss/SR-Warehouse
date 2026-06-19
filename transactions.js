import { db } from "./firebase-init.js";
import {
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { itemsCache, getAutocompleteSuggestions, adjustStock, UNIT_OPTIONS } from "./items.js";
import { logActivity, showToast, escapeHtml, formatTimeID, formatDateID, startOfToday } from "./utils.js";
import { currentUser, can } from "./auth.js";
import {
  startMyCorrectionsListener, onMyCorrectionsChange, getCorrectionStatusForTx, openCorrectionModal
} from "./corrections.js";

export let todayTransactions = [];
let unsubscribeToday = null;
let externalChangeListeners = [];

export function startTodayTransactionsListener(){
  if (unsubscribeToday) return;
  const q = query(
    collection(db, 'transactions'),
    where('timestamp', '>=', Timestamp.fromDate(startOfToday())),
    orderBy('timestamp', 'desc')
  );
  unsubscribeToday = onSnapshot(q, snap => {
    todayTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    externalChangeListeners.forEach(fn => fn(todayTransactions));
  }, (err) => {
    console.error('transactions listener error', err);
    showToast('Gagal memuat data transaksi hari ini.', 'error');
  });
}

export function onTodayTransactionsChange(fn){
  externalChangeListeners.push(fn);
}

export async function recordMasuk({ itemId, itemName, qty, unit, notes }){
  qty = Number(qty);
  if (!itemId || !qty || qty <= 0) throw new Error('Pilih barang dan isi jumlah yang valid.');
  await addDoc(collection(db, 'transactions'), {
    type: 'masuk', itemId, itemName, qty, unit, notes: notes || '',
    userId: currentUser.uid, userName: currentUser.name, timestamp: serverTimestamp()
  });
  const newStock = await adjustStock(itemId, qty, 'delta');
  await logActivity(currentUser.uid, currentUser.name, 'barang_masuk', `${currentUser.name} mencatat barang masuk: ${itemName} (+${qty} ${unit})`);
  return newStock;
}

export async function recordKeluar({ itemId, itemName, qty, unit, notes }){
  qty = Number(qty);
  const item = itemsCache.find(i => i.id === itemId);
  if (!itemId || !qty || qty <= 0) throw new Error('Pilih barang dan isi jumlah yang valid.');
  if (item && qty > item.currentStock) throw new Error(`Stok tidak cukup. Stok tersedia: ${item.currentStock} ${item.unit}.`);
  await addDoc(collection(db, 'transactions'), {
    type: 'keluar', itemId, itemName, qty, unit, notes: notes || '',
    userId: currentUser.uid, userName: currentUser.name, timestamp: serverTimestamp()
  });
  const newStock = await adjustStock(itemId, -qty, 'delta');
  await logActivity(currentUser.uid, currentUser.name, 'barang_keluar', `${currentUser.name} mencatat barang keluar: ${itemName} (-${qty} ${unit})`);
  return newStock;
}

export async function recordOpname({ itemId, itemName, unit, stokFisik, notes }){
  const item = itemsCache.find(i => i.id === itemId);
  if (!item) throw new Error('Pilih barang terlebih dahulu.');
  stokFisik = Number(stokFisik);
  if (Number.isNaN(stokFisik) || stokFisik < 0) throw new Error('Isi jumlah stok fisik yang valid.');
  const stokSistem = item.currentStock;
  const selisih = stokFisik - stokSistem;
  await addDoc(collection(db, 'transactions'), {
    type: 'opname', itemId, itemName, unit,
    stokSistem, stokFisik, selisih, notes: notes || '',
    userId: currentUser.uid, userName: currentUser.name, timestamp: serverTimestamp()
  });
  await adjustStock(itemId, stokFisik, 'set');
  await logActivity(currentUser.uid, currentUser.name, 'stock_opname',
    `${currentUser.name} opname ${itemName}: sistem ${stokSistem}, fisik ${stokFisik}, selisih ${selisih>0?'+':''}${selisih}`);
  return { stokSistem, stokFisik, selisih };
}

/* ===================== UI ===================== */

let activeTab = 'masuk';

export function mountTransaksi(container){
  if (!can('transaction.create')){
    container.innerHTML = `<div class="empty-state">Akun Anda (Viewer) tidak memiliki akses untuk mencatat transaksi.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="tx-tabs">
      <button class="tx-tab" data-tab="masuk">Barang Masuk</button>
      <button class="tx-tab" data-tab="keluar">Barang Keluar</button>
      <button class="tx-tab" data-tab="opname">Stock Opname</button>
    </div>
    <div class="panel-row">
      <div id="tx-form-area"></div>
      <div class="card">
        <div class="card-header"><h3>Transaksi Hari Ini</h3></div>
        <div class="card-body"><ul class="activity-list" id="tx-today-list"></ul></div>
      </div>
    </div>
  `;

  const tabs = container.querySelectorAll('.tx-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => { activeTab = tab.dataset.tab; renderTabUI(); });
  });

  function renderTabUI(){
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
    const area = container.querySelector('#tx-form-area');
    if (activeTab === 'masuk') area.innerHTML = formCardHtml('masuk', 'Catat Barang Masuk', 'btn-primary', 'Simpan Barang Masuk');
    if (activeTab === 'keluar') area.innerHTML = formCardHtml('keluar', 'Catat Barang Keluar', 'btn-danger', 'Simpan Barang Keluar');
    if (activeTab === 'opname') area.innerHTML = opnameFormHtml();
    wireForm(activeTab, area);
  }

  function renderTodayList(){
    const list = container.querySelector('#tx-today-list');
    if (!list) return;
    if (todayTransactions.length === 0){
      list.innerHTML = `<li class="empty-state" style="padding:8px 0">Belum ada transaksi hari ini.</li>`;
      return;
    }
    list.innerHTML = todayTransactions.map(txItemHtml).join('');
    list.querySelectorAll('[data-correct]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = todayTransactions.find(t => t.id === btn.dataset.correct);
        if (tx) openCorrectionModal(tx);
      });
    });
  }

  renderTabUI();
  renderTodayList();
  startMyCorrectionsListener();
  onTodayTransactionsChange(renderTodayList);
  onMyCorrectionsChange(renderTodayList);
}

function txItemHtml(t){
  const d = t.timestamp?.toDate ? t.timestamp.toDate() : new Date();
  const isIn = t.type === 'masuk';
  const isOut = t.type === 'keluar';
  const qtyLabel = isIn ? `+${t.qty} ${t.unit}` : isOut ? `-${t.qty} ${t.unit}` : `${t.selisih>0?'+':''}${t.selisih} ${t.unit}`;
  const qtyClass = isIn ? 'in' : isOut ? 'out' : 'adj';

  const myStatus = getCorrectionStatusForTx(t.id);
  const isOwner = t.userId === currentUser.uid;
  const alreadyFlagged = t.status === 'dibatalkan' || t.status === 'direvisi';
  let statusPill = '';
  if (t.status === 'dibatalkan') statusPill = `<span class="tx-status-pill cancelled">Dibatalkan</span>`;
  else if (t.status === 'direvisi') statusPill = `<span class="tx-status-pill approved">Direvisi</span>`;
  else if (myStatus === 'pending') statusPill = `<span class="tx-status-pill pending">Menunggu Admin</span>`;
  else if (myStatus === 'rejected') statusPill = `<span class="tx-status-pill rejected">Ditolak</span>`;

  const canRequest = can('transaction.request_correction') && isOwner && !alreadyFlagged && myStatus !== 'pending';

  return `
    <li>
      <div class="tx-row">
        <div class="tx-row-left">
          <span class="activity-dot ${t.type}"></span>
          <span>
            <span class="tx-row-name">${escapeHtml(t.itemName)}</span> ${statusPill}
            <br><span class="activity-meta">${formatTimeID(d)} • ${escapeHtml(t.userName)}</span>
          </span>
        </div>
        <span class="tx-row-qty ${qtyClass}">${qtyLabel}</span>
      </div>
      ${canRequest ? `<div class="tx-row-actions" style="margin:4px 0 0 18px"><button data-correct="${t.id}">Ajukan Revisi/Batal</button></div>` : ''}
    </li>
  `;
}

function unitSelectHtml(prefix){
  return `
    <div class="unit-row">
      <select id="${prefix}-unit">
        ${UNIT_OPTIONS.map(u => `<option value="${u}">${u}</option>`).join('')}
        <option value="custom">custom...</option>
      </select>
      <input type="text" id="${prefix}-unit-custom" placeholder="satuan lain" style="display:none">
    </div>
  `;
}

function itemPickerHtml(prefix){
  return `
    <label class="field full" style="position:relative">
      <span>Nama Barang</span>
      <input type="text" id="${prefix}-item-input" placeholder="Ketik nama barang..." autocomplete="off">
      <input type="hidden" id="${prefix}-item-id">
      <div class="autocomplete-list" id="${prefix}-item-ac"></div>
    </label>
  `;
}

function formCardHtml(prefix, title, btnClass, btnLabel){
  const now = new Date();
  return `
    <div class="card tx-form-card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body">
        <div class="tx-meta-readout">
          <span>📅 ${formatDateID(now)}</span>
          <span id="${prefix}-clock">🕒 ${formatTimeID(now)}</span>
          <span>👤 ${escapeHtml(currentUser.name)}</span>
        </div>
        ${itemPickerHtml(prefix)}
        <div class="form-grid">
          <label class="field"><span>Jumlah</span><input type="number" id="${prefix}-qty" min="1"></label>
          <label class="field"><span>Satuan</span>${unitSelectHtml(prefix)}</label>
        </div>
        <label class="field full"><span>Catatan (opsional)</span><textarea id="${prefix}-notes" rows="2"></textarea></label>
        <p class="form-error" id="${prefix}-error" hidden></p>
        <button class="btn ${btnClass} btn-block" id="${prefix}-submit">${btnLabel}</button>
      </div>
    </div>
  `;
}

function opnameFormHtml(){
  const now = new Date();
  return `
    <div class="card tx-form-card">
      <div class="card-header"><h3>Stock Opname</h3></div>
      <div class="card-body">
        <div class="tx-meta-readout">
          <span>📅 ${formatDateID(now)}</span>
          <span id="opname-clock">🕒 ${formatTimeID(now)}</span>
          <span>👤 ${escapeHtml(currentUser.name)}</span>
        </div>
        ${itemPickerHtml('opname')}
        <div class="opname-compare">
          <div class="opname-box"><div class="label">Stok Sistem</div><div class="val" id="opname-sistem">—</div></div>
          <div class="opname-box selisih" id="opname-selisih-box"><div class="label">Selisih</div><div class="val" id="opname-selisih">—</div></div>
        </div>
        <label class="field"><span>Stok Fisik (hasil hitung)</span><input type="number" id="opname-fisik" min="0"></label>
        <label class="field full"><span>Catatan (opsional)</span><textarea id="opname-notes" rows="2"></textarea></label>
        <p class="form-error" id="opname-error" hidden></p>
        <button class="btn btn-accent btn-block" id="opname-submit">Simpan Hasil Opname</button>
      </div>
    </div>
  `;
}

function wireItemPicker(area, prefix, onSelect){
  const input = area.querySelector(`#${prefix}-item-input`);
  const hiddenId = area.querySelector(`#${prefix}-item-id`);
  const ac = area.querySelector(`#${prefix}-item-ac`);
  input.addEventListener('input', () => {
    hiddenId.value = '';
    const matches = getAutocompleteSuggestions(input.value, 6);
    if (matches.length && input.value.trim()){
      ac.innerHTML = matches.map(m => `<div class="ac-item" data-id="${m.id}">${escapeHtml(m.name)} <small>stok: ${m.currentStock} ${escapeHtml(m.unit||'')}</small></div>`).join('');
      ac.classList.add('show');
    } else ac.classList.remove('show');
  });
  input.addEventListener('blur', () => setTimeout(() => ac.classList.remove('show'), 150));
  ac.addEventListener('click', (e) => {
    const row = e.target.closest('.ac-item');
    if (!row) return;
    const item = itemsCache.find(i => i.id === row.dataset.id);
    if (item){
      input.value = item.name;
      hiddenId.value = item.id;
      ac.classList.remove('show');
      if (onSelect) onSelect(item);
    }
  });
}

function wireUnitSelect(area, prefix){
  const select = area.querySelector(`#${prefix}-unit`);
  const custom = area.querySelector(`#${prefix}-unit-custom`);
  if (!select) return;
  select.addEventListener('change', () => { custom.style.display = select.value === 'custom' ? 'block' : 'none'; });
}

function readUnit(area, prefix){
  const select = area.querySelector(`#${prefix}-unit`);
  const custom = area.querySelector(`#${prefix}-unit-custom`);
  return select.value === 'custom' ? custom.value.trim() : select.value;
}

function wireForm(type, area){
  if (type === 'opname'){
    wireItemPicker(area, 'opname', (item) => {
      area.querySelector('#opname-sistem').textContent = `${item.currentStock} ${item.unit||''}`;
      area.querySelector('#opname-selisih').textContent = '—';
      area.querySelector('#opname-fisik').value = '';
    });
    const fisikInput = area.querySelector('#opname-fisik');
    fisikInput.addEventListener('input', () => {
      const itemId = area.querySelector('#opname-item-id').value;
      const item = itemsCache.find(i => i.id === itemId);
      const box = area.querySelector('#opname-selisih-box');
      const out = area.querySelector('#opname-selisih');
      if (!item || fisikInput.value === ''){ out.textContent = '—'; box.classList.remove('plus','minus'); return; }
      const selisih = Number(fisikInput.value) - item.currentStock;
      out.textContent = `${selisih>0?'+':''}${selisih}`;
      box.classList.toggle('plus', selisih > 0);
      box.classList.toggle('minus', selisih < 0);
    });

    area.querySelector('#opname-submit').addEventListener('click', async () => {
      const errorEl = area.querySelector('#opname-error');
      errorEl.hidden = true;
      const itemId = area.querySelector('#opname-item-id').value;
      const item = itemsCache.find(i => i.id === itemId);
      if (!item){ errorEl.textContent = 'Pilih barang dari daftar yang muncul.'; errorEl.hidden = false; return; }
      try{
        const result = await recordOpname({
          itemId, itemName: item.name, unit: item.unit,
          stokFisik: area.querySelector('#opname-fisik').value,
          notes: area.querySelector('#opname-notes').value
        });
        showToast(`Opname tersimpan. Selisih: ${result.selisih>0?'+':''}${result.selisih} ${item.unit}`, 'success');
        area.querySelector('#opname-item-input').value = '';
        area.querySelector('#opname-item-id').value = '';
        area.querySelector('#opname-fisik').value = '';
        area.querySelector('#opname-sistem').textContent = '—';
        area.querySelector('#opname-selisih').textContent = '—';
      }catch(e){
        errorEl.textContent = e.message || 'Gagal menyimpan opname.';
        errorEl.hidden = false;
      }
    });
    return;
  }

  // masuk / keluar
  wireItemPicker(area, type, (item) => {
    const unitSelect = area.querySelector(`#${type}-unit`);
    if (item.unit && Array.from(unitSelect.options).some(o => o.value === item.unit)) unitSelect.value = item.unit;
  });
  wireUnitSelect(area, type);

  area.querySelector(`#${type}-submit`).addEventListener('click', async () => {
    const errorEl = area.querySelector(`#${type}-error`);
    errorEl.hidden = true;
    const itemId = area.querySelector(`#${type}-item-id`).value;
    const item = itemsCache.find(i => i.id === itemId);
    if (!item){ errorEl.textContent = 'Pilih barang dari daftar yang muncul.'; errorEl.hidden = false; return; }
    const qty = area.querySelector(`#${type}-qty`).value;
    const unit = readUnit(area, type);
    if (!unit){ errorEl.textContent = 'Satuan wajib diisi.'; errorEl.hidden = false; return; }

    try{
      const fn = type === 'masuk' ? recordMasuk : recordKeluar;
      await fn({ itemId, itemName: item.name, qty, unit, notes: area.querySelector(`#${type}-notes`).value });
      showToast(type === 'masuk' ? 'Barang masuk tersimpan' : 'Barang keluar tersimpan', 'success');
      area.querySelector(`#${type}-item-input`).value = '';
      area.querySelector(`#${type}-item-id`).value = '';
      area.querySelector(`#${type}-qty`).value = '';
      area.querySelector(`#${type}-notes`).value = '';
    }catch(e){
      errorEl.textContent = e.message || 'Gagal menyimpan transaksi.';
      errorEl.hidden = false;
    }
  });
}
