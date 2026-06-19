import { itemsCache, onItemsChange } from "./items.js";
import { todayTransactions, onTodayTransactionsChange } from "./transactions.js";
import { escapeHtml, formatTimeID } from "./utils.js";
import { currentUser } from "./auth.js";
import { generateMyActivityReport } from "./reports.js";

const PREVIEW_COUNT = 5;

export function computeDashboardStats(){
  const totalJenisBarang = itemsCache.length;
  const totalStok = itemsCache.reduce((sum, i) => sum + (i.currentStock || 0), 0);
  const masuk = todayTransactions.filter(t => t.type === 'masuk');
  const keluar = todayTransactions.filter(t => t.type === 'keluar');
  const stokMenipis = itemsCache
    .filter(i => i.currentStock <= (i.minStock || 0))
    .sort((a,b) => a.currentStock - b.currentStock);

  const aktivitasSource = currentUser.role === 'staff'
    ? todayTransactions.filter(t => t.userId === currentUser.uid)
    : todayTransactions;

  return {
    totalJenisBarang,
    totalStok,
    masukCount: masuk.length,
    masukQty: masuk.reduce((s,t) => s + (t.qty||0), 0),
    keluarCount: keluar.length,
    keluarQty: keluar.reduce((s,t) => s + (t.qty||0), 0),
    stokMenipis,
    aktivitas: aktivitasSource
  };
}

export function mountDashboard(container){
  function render(){
    const s = computeDashboardStats();
    container.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total Jenis Barang</div>
          <div class="stat-value">${s.totalJenisBarang}</div>
          <div class="stat-sub">item terdaftar</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Stok</div>
          <div class="stat-value">${s.totalStok}</div>
          <div class="stat-sub">unit di seluruh gudang</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-label">Barang Masuk Hari Ini</div>
          <div class="stat-value">${s.masukQty}</div>
          <div class="stat-sub">${s.masukCount} transaksi</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-label">Barang Keluar Hari Ini</div>
          <div class="stat-value">${s.keluarQty}</div>
          <div class="stat-sub">${s.keluarCount} transaksi</div>
        </div>
      </div>
      <div class="panel-row">
        <div class="card">
          <div class="card-header">
            <h3>${currentUser.role === 'staff' ? 'Aktivitas Saya Hari Ini' : 'Ringkasan Aktivitas Hari Ini'}</h3>
            ${currentUser.role === 'staff' ? `<button class="btn btn-ghost btn-sm" id="db-gen-report">Generate Laporan Saya</button>` : ''}
          </div>
          <div class="card-body">
            ${expandableList(s.aktivitas, activityRowHtml, 'Belum ada aktivitas.', 'db-activity')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Stok Menipis</h3></div>
          <div class="card-body">
            ${expandableList(s.stokMenipis, lowStockRowHtml, 'Semua stok aman 👍', 'db-lowstock', 'low-stock-list')}
          </div>
        </div>
      </div>
    `;

    const genBtn = container.querySelector('#db-gen-report');
    if (genBtn){
      genBtn.addEventListener('click', async () => {
        genBtn.disabled = true;
        try{ await generateMyActivityReport(); } finally { genBtn.disabled = false; }
      });
    }
    wireExpandButtons(container);
  }

  render();
  onItemsChange(render);
  onTodayTransactionsChange(render);
}

function expandableList(items, rowFn, emptyMsg, idPrefix, listClass = 'activity-list'){
  if (!items.length){
    return `<div class="empty-state" style="padding:8px 0">${emptyMsg}</div>`;
  }
  const visible = items.slice(0, PREVIEW_COUNT);
  const rest = items.slice(PREVIEW_COUNT);
  return `
    <ul class="${listClass}">${visible.map(rowFn).join('')}</ul>
    ${rest.length ? `
      <ul class="${listClass} hidden-extra" id="${idPrefix}-extra">${rest.map(rowFn).join('')}</ul>
      <button class="expand-toggle" data-expand="${idPrefix}"><span class="chev">▼</span> Lihat ${rest.length} lainnya</button>
    ` : ''}
  `;
}

function wireExpandButtons(container){
  container.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const extra = container.querySelector(`#${btn.dataset.expand}-extra`);
      const isOpen = extra.classList.toggle('show');
      btn.classList.toggle('open', isOpen);
      btn.innerHTML = isOpen ? `<span class="chev">▼</span> Sembunyikan` : `<span class="chev">▼</span> Lihat ${extra.children.length} lainnya`;
    });
  });
}

function activityRowHtml(t){
  const d = t.timestamp?.toDate ? t.timestamp.toDate() : new Date();
  const label = t.type === 'masuk' ? `Barang masuk +${t.qty} ${t.unit}`
    : t.type === 'keluar' ? `Barang keluar -${t.qty} ${t.unit}`
    : `Stock opname, selisih ${t.selisih>0?'+':''}${t.selisih} ${t.unit}`;
  return `
    <li>
      <span class="activity-dot ${t.type}"></span>
      <span>
        <strong>${escapeHtml(t.itemName)}</strong> — ${label}
        <br><span class="activity-meta">${formatTimeID(d)} • ${escapeHtml(t.userName)}</span>
      </span>
    </li>
  `;
}

function lowStockRowHtml(item){
  return `
    <li>
      <span>${escapeHtml(item.name)}</span>
      <span>
        <span class="qty-main">${item.currentStock}</span><span class="qty-unit">${escapeHtml(item.unit||'')}</span>
        <span class="qty-min">min ${item.minStock||0} ${escapeHtml(item.unit||'')}</span>
      </span>
    </li>
  `;
}
