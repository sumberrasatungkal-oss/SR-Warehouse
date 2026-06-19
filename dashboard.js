import { itemsCache, onItemsChange } from "./items.js";
import { todayTransactions, onTodayTransactionsChange } from "./transactions.js";
import { escapeHtml, formatTimeID } from "./utils.js";

export function computeDashboardStats(){
  const totalJenisBarang = itemsCache.length;
  const totalStok = itemsCache.reduce((sum, i) => sum + (i.currentStock || 0), 0);
  const masuk = todayTransactions.filter(t => t.type === 'masuk');
  const keluar = todayTransactions.filter(t => t.type === 'keluar');
  const stokMenipis = itemsCache
    .filter(i => i.currentStock <= (i.minStock || 0))
    .sort((a,b) => a.currentStock - b.currentStock);

  return {
    totalJenisBarang,
    totalStok,
    masukCount: masuk.length,
    masukQty: masuk.reduce((s,t) => s + (t.qty||0), 0),
    keluarCount: keluar.length,
    keluarQty: keluar.reduce((s,t) => s + (t.qty||0), 0),
    stokMenipis,
    aktivitasHariIni: todayTransactions.slice(0, 8)
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
          <div class="card-header"><h3>Ringkasan Aktivitas Hari Ini</h3></div>
          <div class="card-body">
            <ul class="activity-list">
              ${s.aktivitasHariIni.length ? s.aktivitasHariIni.map(activityRowHtml).join('') : `<li class="empty-state" style="padding:8px 0">Belum ada aktivitas hari ini.</li>`}
            </ul>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Stok Menipis</h3></div>
          <div class="card-body">
            <ul class="low-stock-list">
              ${s.stokMenipis.length ? s.stokMenipis.map(lowStockRowHtml).join('') : `<li style="background:none;justify-content:center;color:var(--muted)">Semua stok aman 👍</li>`}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  render();
  onItemsChange(render);
  onTodayTransactionsChange(render);
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
      <span class="qty">${item.currentStock} / min ${item.minStock||0} ${escapeHtml(item.unit||'')}</span>
    </li>
  `;
}
