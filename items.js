import { db } from "./firebase-init.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getInitialLetter, normalize, logActivity, showToast, escapeHtml } from "./utils.js";
import { can, currentUser } from "./auth.js";

export let itemsCache = [];
export let categoriesCache = [];

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const UNIT_OPTIONS = ['dus','ikt','bal','pcs','lsn','crt'];

let unsubscribeItems = null;
let externalChangeListeners = [];

export function startItemsListener(){
  if (unsubscribeItems) return;
  const q = query(collection(db, 'items'), orderBy('name'));
  unsubscribeItems = onSnapshot(q, (snap) => {
    itemsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const catSet = new Set(itemsCache.map(i => i.category).filter(Boolean));
    categoriesCache = Array.from(catSet).sort((a,b)=>a.localeCompare(b));
    externalChangeListeners.forEach(fn => fn(itemsCache));
  }, (err) => {
    console.error('items listener error', err);
    showToast('Gagal memuat data barang. Cek koneksi/izin Firestore.', 'error');
  });
}

export function onItemsChange(fn){
  externalChangeListeners.push(fn);
}

export function filterItems({ searchTerm = '', category = '' } = {}){
  const term = normalize(searchTerm);
  return itemsCache.filter(item => {
    const matchSearch = !term || normalize(item.name).includes(term);
    const matchCategory = !category || item.category === category;
    return matchSearch && matchCategory;
  });
}

export function groupByLetter(items){
  const groups = {};
  items.forEach(item => {
    const letter = getInitialLetter(item.name);
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(item);
  });
  return groups;
}

export function getAutocompleteSuggestions(input, limit = 6){
  const term = normalize(input);
  if (!term) return [];
  return itemsCache.filter(i => normalize(i.name).includes(term)).slice(0, limit);
}

export async function addItem({ name, category, unit, initialStock, minStock }){
  const ref = await addDoc(collection(db, 'items'), {
    name: name.trim(),
    category: (category || '').trim(),
    unit,
    currentStock: Number(initialStock) || 0,
    minStock: Number(minStock) || 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: currentUser?.name || 'system'
  });
  await logActivity(currentUser.uid, currentUser.name, 'tambah_barang', `Menambahkan barang "${name}"`);
  return ref.id;
}

export async function updateItem(itemId, changes){
  await updateDoc(doc(db, 'items', itemId), { ...changes, updatedAt: serverTimestamp() });
  await logActivity(currentUser.uid, currentUser.name, 'edit_barang', `Mengubah data barang "${changes.name || itemId}"`);
}

export async function deleteItemById(itemId, itemName){
  await deleteDoc(doc(db, 'items', itemId));
  await logActivity(currentUser.uid, currentUser.name, 'hapus_barang', `Menghapus barang "${itemName}"`);
}

export async function adjustStock(itemId, value, mode = 'delta'){
  const item = itemsCache.find(i => i.id === itemId);
  if (!item) throw new Error('Barang tidak ditemukan');
  const newStock = mode === 'set' ? value : item.currentStock + value;
  await updateDoc(doc(db, 'items', itemId), { currentStock: newStock, updatedAt: serverTimestamp() });
  return newStock;
}

/* ===================== UI ===================== */

let state = { search: '', category: '' };

export function mountMasterData(container){
  container.innerHTML = `
    <div class="toolbar">
      <div class="search-wrap">
        <input type="text" id="md-search" placeholder="Cari nama barang...">
        <div class="autocomplete-list" id="md-search-ac"></div>
      </div>
      <select id="md-category-filter"><option value="">Semua Kategori</option></select>
      ${can('items.create') ? `<button class="btn btn-accent" id="md-add-btn">+ Tambah Barang</button>` : ''}
    </div>
    <div class="az-layout">
      <div class="az-list-wrap" id="md-list-wrap"></div>
      <div class="az-slider" id="md-az-slider"></div>
    </div>
  `;

  const searchInput = container.querySelector('#md-search');
  const searchAc = container.querySelector('#md-search-ac');
  const categorySelect = container.querySelector('#md-category-filter');
  const listWrap = container.querySelector('#md-list-wrap');
  const azSlider = container.querySelector('#md-az-slider');
  const addBtn = container.querySelector('#md-add-btn');

  function renderCategoryOptions(){
    const prev = categorySelect.value;
    categorySelect.innerHTML = `<option value="">Semua Kategori</option>` +
      categoriesCache.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    categorySelect.value = prev;
  }

  function renderAzSlider(groups){
    azSlider.innerHTML = ALPHABET.map(letter => {
      const has = !!groups[letter];
      return `<button data-letter="${letter}" ${has ? '' : 'disabled'}>${letter}</button>`;
    }).join('');
    azSlider.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = listWrap.querySelector(`[data-group="${btn.dataset.letter}"]`);
        if (target) target.scrollIntoView({ block: 'start' });
      });
    });
  }

  function renderList(){
    const filtered = filterItems(state);
    const groups = groupByLetter(filtered);
    renderAzSlider(groups);

    if (filtered.length === 0){
      listWrap.innerHTML = `<div class="empty-state">Tidak ada barang yang cocok. ${can('items.create') ? 'Coba tambah barang baru.' : ''}</div>`;
      return;
    }

    const letters = Object.keys(groups).sort();
    listWrap.innerHTML = letters.map(letter => `
      <div data-group="${letter}">
        <div class="az-group-header">${letter}</div>
        ${groups[letter].map(item => itemRowHtml(item)).join('')}
      </div>
    `).join('');

    listWrap.querySelectorAll('.item-row').forEach(row => {
      row.addEventListener('click', () => {
        const item = itemsCache.find(i => i.id === row.dataset.id);
        if (item) openItemModal(item);
      });
    });
  }

  function itemRowHtml(item){
    const low = item.currentStock <= (item.minStock || 0);
    return `
      <div class="item-row" data-id="${item.id}">
        <div class="item-main">
          <span class="item-name">${escapeHtml(item.name)}</span>
          <span class="item-cat">${escapeHtml(item.category || 'Tanpa kategori')}</span>
        </div>
        <div class="item-stock ${low ? 'low' : ''}">
          ${item.currentStock}
          <span class="item-stock-unit">${escapeHtml(item.unit || '')}</span>
        </div>
      </div>
    `;
  }

  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    renderList();
    const matches = getAutocompleteSuggestions(searchInput.value, 6);
    if (matches.length && searchInput.value.trim()){
      searchAc.innerHTML = matches.map(m => `<div class="ac-item" data-id="${m.id}">${escapeHtml(m.name)} <small>${escapeHtml(m.category||'')}</small></div>`).join('');
      searchAc.classList.add('show');
    } else {
      searchAc.classList.remove('show');
    }
  });
  searchInput.addEventListener('blur', () => setTimeout(() => searchAc.classList.remove('show'), 150));
  searchAc.addEventListener('click', (e) => {
    const row = e.target.closest('.ac-item');
    if (!row) return;
    const item = itemsCache.find(i => i.id === row.dataset.id);
    if (item){ searchInput.value = item.name; state.search = item.name; renderList(); }
    searchAc.classList.remove('show');
  });

  categorySelect.addEventListener('change', () => {
    state.category = categorySelect.value;
    renderList();
  });

  if (addBtn){
    addBtn.addEventListener('click', () => openItemModal(null));
  }

  renderCategoryOptions();
  renderList();

  onItemsChange(() => { renderCategoryOptions(); renderList(); });
}

function unitFieldHtml(selectedUnit, prefix){
  const isCustom = selectedUnit && !UNIT_OPTIONS.includes(selectedUnit);
  return `
    <div class="unit-row">
      <select id="${prefix}-unit">
        ${UNIT_OPTIONS.map(u => `<option value="${u}" ${selectedUnit===u?'selected':''}>${u}</option>`).join('')}
        <option value="custom" ${isCustom?'selected':''}>custom...</option>
      </select>
      <input type="text" id="${prefix}-unit-custom" placeholder="satuan lain" value="${isCustom?escapeHtml(selectedUnit):''}" style="${isCustom?'':'display:none'}">
    </div>
  `;
}

function wireUnitField(modal, prefix){
  const select = modal.querySelector(`#${prefix}-unit`);
  const custom = modal.querySelector(`#${prefix}-unit-custom`);
  select.addEventListener('change', () => {
    custom.style.display = select.value === 'custom' ? 'block' : 'none';
  });
}

function readUnitField(modal, prefix){
  const select = modal.querySelector(`#${prefix}-unit`);
  const custom = modal.querySelector(`#${prefix}-unit-custom`);
  return select.value === 'custom' ? custom.value.trim() : select.value;
}

function openItemModal(item){
  const isEdit = !!item;
  const canEdit = isEdit ? can('items.edit') : can('items.create');
  const root = document.getElementById('modal-root');

  root.innerHTML = `
    <div class="modal-overlay" id="item-modal-overlay">
      <div class="modal-box">
        <div class="modal-header">
          <h3>${isEdit ? 'Detail Barang' : 'Tambah Barang'}</h3>
          <button class="btn-icon" id="item-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <label class="field full" style="position:relative">
              <span>Nama Barang</span>
              <input type="text" id="im-name" value="${isEdit ? escapeHtml(item.name) : ''}" ${canEdit?'':'disabled'} autocomplete="off">
              <div class="autocomplete-list" id="im-name-ac"></div>
            </label>
            <label class="field">
              <span>Kategori</span>
              <input type="text" id="im-category" list="im-category-list" value="${isEdit ? escapeHtml(item.category||'') : ''}" ${canEdit?'':'disabled'}>
              <datalist id="im-category-list">${categoriesCache.map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist>
            </label>
            <label class="field">
              <span>Satuan</span>
              ${unitFieldHtml(isEdit ? item.unit : 'pcs', 'im')}
            </label>
            <label class="field">
              <span>${isEdit ? 'Stok Saat Ini' : 'Stok Awal'}</span>
              <input type="number" id="im-stock" value="${isEdit ? item.currentStock : 0}" ${isEdit ? 'disabled' : (canEdit?'':'disabled')} min="0">
              ${isEdit ? '<p class="form-hint">Untuk koreksi stok, gunakan menu Transaksi &gt; Stock Opname.</p>' : ''}
            </label>
            <label class="field">
              <span>Stok Minimum</span>
              <input type="number" id="im-min-stock" value="${isEdit ? (item.minStock||0) : 0}" ${canEdit?'':'disabled'} min="0">
            </label>
          </div>
          <p class="form-error" id="item-modal-error" hidden></p>
        </div>
        <div class="modal-footer">
          ${isEdit && can('items.delete') ? `<button class="btn btn-danger" id="item-modal-delete" style="margin-right:auto">Hapus</button>` : ''}
          <button class="btn btn-ghost" id="item-modal-cancel">Tutup</button>
          ${canEdit ? `<button class="btn btn-primary" id="item-modal-save">Simpan</button>` : ''}
        </div>
      </div>
    </div>
  `;

  const overlay = root.querySelector('#item-modal-overlay');
  const close = () => { root.innerHTML = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.querySelector('#item-modal-close').addEventListener('click', close);
  root.querySelector('#item-modal-cancel').addEventListener('click', close);

  wireUnitField(root, 'im');

  if (!isEdit){
    const nameInput = root.querySelector('#im-name');
    const nameAc = root.querySelector('#im-name-ac');
    nameInput.addEventListener('input', () => {
      const matches = getAutocompleteSuggestions(nameInput.value, 5);
      if (matches.length && nameInput.value.trim()){
        nameAc.innerHTML = matches.map(m => `<div class="ac-item">${escapeHtml(m.name)} <small>sudah ada — ${escapeHtml(m.category||'')}</small></div>`).join('');
        nameAc.classList.add('show');
      } else nameAc.classList.remove('show');
    });
    nameInput.addEventListener('blur', () => setTimeout(()=>nameAc.classList.remove('show'),150));
  }

  if (isEdit && can('items.delete')){
    root.querySelector('#item-modal-delete').addEventListener('click', async () => {
      if (!confirm(`Hapus barang "${item.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
      try{
        await deleteItemById(item.id, item.name);
        showToast('Barang berhasil dihapus', 'success');
        close();
      }catch(e){
        console.error(e);
        showToast('Gagal menghapus barang', 'error');
      }
    });
  }

  if (canEdit){
    root.querySelector('#item-modal-save').addEventListener('click', async () => {
      const errorEl = root.querySelector('#item-modal-error');
      errorEl.hidden = true;
      const name = root.querySelector('#im-name').value.trim();
      const category = root.querySelector('#im-category').value.trim();
      const unit = readUnitField(root, 'im');
      const minStock = root.querySelector('#im-min-stock').value;

      if (!name){ errorEl.textContent = 'Nama barang wajib diisi.'; errorEl.hidden = false; return; }
      if (!unit){ errorEl.textContent = 'Satuan wajib diisi.'; errorEl.hidden = false; return; }

      try{
        if (isEdit){
          await updateItem(item.id, { name, category, unit, minStock: Number(minStock)||0 });
          showToast('Perubahan disimpan', 'success');
        } else {
          const initialStock = root.querySelector('#im-stock').value;
          await addItem({ name, category, unit, initialStock, minStock });
          showToast('Barang baru ditambahkan', 'success');
        }
        close();
      }catch(e){
        console.error(e);
        errorEl.textContent = 'Gagal menyimpan. Coba lagi.';
        errorEl.hidden = false;
      }
    });
  }
}

export { UNIT_OPTIONS };
