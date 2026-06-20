import { db } from "./firebase-init.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { currentUser } from "./auth.js";
import { itemsCache, getAutocompleteSuggestions } from "./items.js";
import {
  escapeHtml, showToast, formatDateID, formatTimeID, formatDateTimeID,
  isoDateInput, startOfDate, endOfDate
} from "./utils.js";

async function fetchTransactionsInRange(start, end){
  const q = query(
    collection(db, 'transactions'),
    where('timestamp', '>=', Timestamp.fromDate(start)),
    where('timestamp', '<=', Timestamp.fromDate(end)),
    orderBy('timestamp', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function downloadExcel(filename, headers, rows){
  if (typeof XLSX === 'undefined'){
    showToast('Modul Excel belum termuat. Cek koneksi internet lalu coba lagi.', 'error');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  XLSX.writeFile(wb, filename);
}

const REPORT_TYPES = [
  { key: 'masuk_keluar', label: 'Keluar Masuk Barang' },
  { key: 'detail_barang', label: 'Detail Barang Tertentu' },
  { key: 'stok_menipis', label: 'Stok Menipis' },
  { key: 'opname', label: 'Stock Opname' }
];

let state = {
  reportType: 'masuk_keluar',
  period: 'today',
  customFrom: isoDateInput(new Date()),
  customTo: isoDateInput(new Date()),
  selectedItemId: ''
};

function getRange(){
  const now = new Date();
  if (state.period === 'today') return { start: startOfDate(now), end: endOfDate(now) };
  if (state.period === 'month'){
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfDate(start), end: endOfDate(now) };
  }
  if (state.period === 'year'){
    const start = new Date(now.getFullYear(), 0, 1);
    return { start: startOfDate(start), end: endOfDate(now) };
  }
  return { start: startOfDate(state.customFrom), end: endOfDate(state.customTo) };
}

export function mountReports(container){
  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Pilih Jenis Laporan</h3></div>
      <div class="card-body">
        <div class="report-types" id="report-type-grid"></div>

        <div id="report-item-picker" style="display:none; position:relative; margin-bottom:14px;">
          <label class="field full">
            <span>Pilih Barang</span>
            <input type="text" id="report-item-input" placeholder="Ketik nama barang..." autocomplete="off">
            <input type="hidden" id="report-item-id">
            <div class="autocomplete-list" id="report-item-ac"></div>
          </label>
        </div>

        <div id="report-period-area">
          <div class="period-presets" id="report-period-presets">
            <button data-period="today">Hari Ini</button>
            <button data-period="month">Bulan Ini</button>
            <button data-period="year">Tahun Ini</button>
            <button data-period="custom">Custom</button>
          </div>
          <div class="date-range-row" id="report-custom-range" style="display:none">
            <label class="field"><span>Dari Tanggal</span><input type="date" id="report-from"></label>
            <label class="field"><span>Sampai Tanggal</span><input type="date" id="report-to"></label>
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:8px;">
          <button class="btn btn-primary" id="report-generate">Tampilkan Laporan</button>
          <button class="btn btn-accent" id="report-export-excel">Export ke Excel</button>
        </div>
      </div>
    </div>
    <div id="report-output"></div>
  `;

  const typeGrid = container.querySelector('#report-type-grid');
  typeGrid.innerHTML = REPORT_TYPES.map(rt => `<div class="report-type-card ${state.reportType===rt.key?'active':''}" data-type="${rt.key}">${rt.label}</div>`).join('');
  typeGrid.querySelectorAll('.report-type-card').forEach(card => {
    card.addEventListener('click', () => {
      state.reportType = card.dataset.type;
      typeGrid.querySelectorAll('.report-type-card').forEach(c => c.classList.toggle('active', c === card));
      const isDetail = state.reportType === 'detail_barang';
      const isStokMenipis = state.reportType === 'stok_menipis';
      container.querySelector('#report-item-picker').style.display = isDetail ? 'block' : 'none';
      container.querySelector('#report-period-area').style.display = isStokMenipis ? 'none' : 'block';
    });
  });

  const periodWrap = container.querySelector('#report-period-presets');
  periodWrap.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === state.period);
    btn.addEventListener('click', () => {
      state.period = btn.dataset.period;
      periodWrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelector('#report-custom-range').style.display = state.period === 'custom' ? 'flex' : 'none';
    });
  });
  container.querySelector('#report-from').value = state.customFrom;
  container.querySelector('#report-to').value = state.customTo;
  container.querySelector('#report-from').addEventListener('change', (e) => state.customFrom = e.target.value);
  container.querySelector('#report-to').addEventListener('change', (e) => state.customTo = e.target.value);

  const itemInput = container.querySelector('#report-item-input');
  const itemHidden = container.querySelector('#report-item-id');
  const itemAc = container.querySelector('#report-item-ac');
  itemInput.addEventListener('input', () => {
    itemHidden.value = '';
    const matches = getAutocompleteSuggestions(itemInput.value, 6);
    if (matches.length && itemInput.value.trim()){
      itemAc.innerHTML = matches.map(m => `<div class="ac-item" data-id="${m.id}">${escapeHtml(m.name)}</div>`).join('');
      itemAc.classList.add('show');
    } else itemAc.classList.remove('show');
  });
  itemInput.addEventListener('blur', () => setTimeout(() => itemAc.classList.remove('show'), 150));
  itemAc.addEventListener('click', (e) => {
    const row = e.target.closest('.ac-item');
    if (!row) return;
    const item = itemsCache.find(i => i.id === row.dataset.id);
    if (item){ itemInput.value = item.name; itemHidden.value = item.id; state.selectedItemId = item.id; }
    itemAc.classList.remove('show');
  });

  container.querySelector('#report-generate').addEventListener('click', () => runReport(container, false));
  container.querySelector('#report-export-excel').addEventListener('click', () => runReport(container, true));
}

async function runReport(container, exportExcel){
  const outputEl = container.querySelector('#report-output');
  outputEl.innerHTML = `<div class="empty-state">Memuat data...</div>`;

  try{
    if (state.reportType === 'stok_menipis'){
      const rows = itemsCache.filter(i => i.currentStock <= (i.minStock||0)).sort((a,b)=>a.currentStock-b.currentStock);
      if (exportExcel){
        const headers = ['Nama Barang','Kategori','Stok Saat Ini','Stok Minimum','Satuan'];
        const data = rows.map(i => [i.name, i.category||'-', i.currentStock, i.minStock||0, i.unit||'']);
        return downloadExcel(`stok-menipis-${isoDateInput(new Date())}.xlsx`, headers, data);
      }
      return renderStokMenipisReport(outputEl, { rows });
    }

    const { start, end } = getRange();
    const periodText = `${formatDateID(start)} — ${formatDateID(end)}`;
    const all = await fetchTransactionsInRange(start, end);

    if (state.reportType === 'masuk_keluar'){
      const rows = all.filter(t => t.type === 'masuk' || t.type === 'keluar');
      const totalMasuk = rows.filter(t=>t.type==='masuk').reduce((s,t)=>s+t.qty,0);
      const totalKeluar = rows.filter(t=>t.type==='keluar').reduce((s,t)=>s+t.qty,0);
      if (exportExcel){
        const headers = ['Tanggal','Jam','Barang','Jenis','Jumlah','Satuan','User'];
        const data = rows.map(t => {
          const d = t.timestamp.toDate();
          return [formatDateID(d), formatTimeID(d), t.itemName, t.type === 'masuk' ? 'Masuk' : 'Keluar', t.qty, t.unit, t.userName];
        });
        return downloadExcel(`keluar-masuk-${isoDateInput(start)}_${isoDateInput(end)}.xlsx`, headers, data);
      }
      return renderTransactionReport(outputEl, {
        title: 'Keluar Masuk Barang', meta: `Periode: ${periodText}`, rows,
        totalsLabel: `Total Masuk <span class="tx-row-qty in">+${totalMasuk}</span> &nbsp;•&nbsp; Total Keluar <span class="tx-row-qty out">-${totalKeluar}</span>`,
        emptyMsg: 'Tidak ada transaksi masuk/keluar pada periode ini.'
      });
    }

    if (state.reportType === 'opname'){
      const rows = all.filter(t => t.type === 'opname');
      if (exportExcel){
        const headers = ['Tanggal','Jam','Barang','Stok Sistem','Stok Fisik','Selisih','Satuan','User'];
        const data = rows.map(t => {
          const d = t.timestamp.toDate();
          return [formatDateID(d), formatTimeID(d), t.itemName, t.stokSistem, t.stokFisik, t.selisih, t.unit, t.userName];
        });
        return downloadExcel(`stock-opname-${isoDateInput(start)}_${isoDateInput(end)}.xlsx`, headers, data);
      }
      return renderTransactionReport(outputEl, {
        title: 'Stock Opname', meta: `Periode: ${periodText}`, rows,
        totalsLabel: `${rows.length} kali opname`,
        emptyMsg: 'Tidak ada stock opname pada periode ini.'
      });
    }

    if (state.reportType === 'detail_barang'){
      if (!state.selectedItemId){
        outputEl.innerHTML = `<div class="empty-state">Pilih barang terlebih dahulu.</div>`;
        return;
      }
      const rows = all.filter(t => t.itemId === state.selectedItemId);
      const itemName = itemsCache.find(i => i.id === state.selectedItemId)?.name || '';
      if (exportExcel){
        const headers = ['Tanggal','Jam','Jenis','Jumlah/Selisih','Satuan','User'];
        const data = rows.map(t => {
          const d = t.timestamp.toDate();
          const jenis = t.type === 'masuk' ? 'Masuk' : t.type === 'keluar' ? 'Keluar' : 'Opname';
          const jumlah = t.type === 'opname' ? t.selisih : t.qty;
          return [formatDateID(d), formatTimeID(d), jenis, jumlah, t.unit, t.userName];
        });
        return downloadExcel(`detail-${itemName}-${isoDateInput(start)}_${isoDateInput(end)}.xlsx`, headers, data);
      }
      return renderTransactionReport(outputEl, {
        title: `Detail: ${itemName}`, meta: `Periode: ${periodText}`, rows,
        totalsLabel: `${rows.length} transaksi`,
        emptyMsg: 'Tidak ada transaksi untuk barang ini pada periode ini.'
      });
    }
  }catch(e){
    console.error(e);
    outputEl.innerHTML = `<div class="empty-state">Gagal memuat laporan. Coba lagi.</div>`;
  }
}

function txReportRowHtml(t){
  const d = t.timestamp.toDate();
  let qtyHtml, sub;
  if (t.type === 'masuk'){
    qtyHtml = `<span class="tx-row-qty in">+${t.qty} ${escapeHtml(t.unit)}</span>`;
    sub = `${formatDateID(d)} • ${formatTimeID(d)} • ${escapeHtml(t.userName)}`;
  } else if (t.type === 'keluar'){
    qtyHtml = `<span class="tx-row-qty out">-${t.qty} ${escapeHtml(t.unit)}</span>`;
    sub = `${formatDateID(d)} • ${formatTimeID(d)} • ${escapeHtml(t.userName)}`;
  } else {
    qtyHtml = `<span class="tx-row-qty adj">${t.selisih>0?'+':''}${t.selisih} ${escapeHtml(t.unit)}</span>`;
    sub = `Sistem ${t.stokSistem} → Fisik ${t.stokFisik} • ${formatDateID(d)} ${formatTimeID(d)} • ${escapeHtml(t.userName)}`;
  }
  return `
    <li class="report-row ${t.type}">
      <div class="tx-row">
        <div class="tx-row-left">
          <span class="activity-dot ${t.type}"></span>
          <span><span class="tx-row-name">${escapeHtml(t.itemName)}</span><br><span class="activity-meta">${sub}</span></span>
        </div>
        ${qtyHtml}
      </div>
    </li>
  `;
}

function renderTransactionReport(outputEl, { title, meta, rows, totalsLabel, emptyMsg }){
  outputEl.innerHTML = `
    <div class="report-output report-output-compact">
      <div class="report-brand"><img src="logo.jpg" alt="Sumber Rasa" width="32" height="32"><div><h4>${escapeHtml(title)}</h4></div></div>
      <div class="report-meta">${escapeHtml(meta)} • ${formatDateTimeID(new Date())}</div>
      ${totalsLabel ? `<div class="report-totals">${totalsLabel}</div>` : ''}
      <ul class="report-row-list">
        ${rows.length ? rows.map(txReportRowHtml).join('') : `<li class="empty-state" style="padding:14px 0">${emptyMsg}</li>`}
      </ul>
    </div>
  `;
}

function renderStokMenipisReport(outputEl, { rows }){
  outputEl.innerHTML = `
    <div class="report-output report-output-compact">
      <div class="report-brand"><img src="logo.jpg" alt="Sumber Rasa" width="32" height="32"><div><h4>Laporan Stok Menipis</h4></div></div>
      <div class="report-meta">Per ${formatDateTimeID(new Date())}</div>
      <div class="report-totals">${rows.length} barang di bawah/sama dengan stok minimum</div>
      <ul class="low-stock-list">
        ${rows.length ? rows.map(i => `
          <li>
            <span>${escapeHtml(i.name)}</span>
            <span>
              <span class="qty-main">${i.currentStock}</span><span class="qty-unit">${escapeHtml(i.unit||'')}</span>
              <span class="qty-min">min ${i.minStock||0} ${escapeHtml(i.unit||'')}</span>
            </span>
          </li>`).join('') : `<li style="background:none;justify-content:center;color:var(--muted)">Semua stok aman 👍</li>`}
      </ul>
    </div>
  `;
}

/* ===================== Laporan Aktivitas Pribadi (per staff) ===================== */

export async function getLastGeneratedAt(){
  try{
    const snap = await getDoc(doc(db, 'userReportState', currentUser.uid));
    return snap.exists() && snap.data().lastGeneratedAt ? snap.data().lastGeneratedAt.toDate() : new Date(0);
  }catch(e){
    console.error(e);
    return new Date(0);
  }
}

export async function markGeneratedNow(){
  await setDoc(doc(db, 'userReportState', currentUser.uid), { lastGeneratedAt: serverTimestamp() }, { merge: true });
}

export async function generateMyActivityReport(){
  const since = await getLastGeneratedAt();
  const q = query(collection(db, 'transactions'), where('userId', '==', currentUser.uid));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.timestamp && t.timestamp.toDate() > since)
    .sort((a,b) => a.timestamp.toMillis() - b.timestamp.toMillis());
  openMyActivityModal(rows);
}

function openMyActivityModal(rows){
  const root = document.getElementById('modal-root');

  root.innerHTML = `
    <div class="modal-overlay" id="myreport-overlay">
      <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
          <h3>Laporan Aktivitas Saya</h3>
          <button class="btn-icon" id="myreport-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="report-output report-output-compact" style="margin:0; padding:0;">
            <div class="report-brand"><img src="logo.jpg" alt="Sumber Rasa" width="32" height="32"><div><h4>${escapeHtml(currentUser.name)}</h4></div></div>
            <div class="report-meta">${rows.length} transaksi belum pernah digenerate • ${formatDateTimeID(new Date())}</div>
            <ul class="report-row-list">
              ${rows.length ? rows.map(txReportRowHtml).join('') : `<li class="empty-state" style="padding:14px 0">Tidak ada aktivitas baru.</li>`}
            </ul>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="myreport-dismiss">Tutup tanpa tandai</button>
          <button class="btn btn-primary" id="myreport-mark">Tandai Sudah Digenerate</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#myreport-overlay').addEventListener('click', (e) => { if (e.target.id === 'myreport-overlay') close(); });
  root.querySelector('#myreport-close').addEventListener('click', close);
  root.querySelector('#myreport-dismiss').addEventListener('click', close);
  root.querySelector('#myreport-mark').addEventListener('click', async () => {
    await markGeneratedNow();
    showToast('Laporan ditandai sudah digenerate', 'success');
    close();
  });
}
