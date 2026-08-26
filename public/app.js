// ==========================================================================
// TRENDYOL AYAZAĞA KM - COMMAND CENTER CLIENT LOGIC & REAL-TIME WEBSOCKETS
// ==========================================================================

const socket = io();

// DOM References
const statusBadge = document.getElementById('status-badge');
const statusLabel = document.getElementById('status-label');
const qrCanvas = document.getElementById('qr-canvas');
const qrPlaceholder = document.getElementById('qr-placeholder');
const driversTbody = document.getElementById('drivers-tbody');
const logsList = document.getElementById('logs-list');
const cutoffSelect = document.getElementById('cutoff-select');

// State
let allDrivers = [];
let currentFilter = 'all';
let searchQuery = '';
let currentCutoffHour = 19;
let editingDriverId = null;

// ==========================================================================
// REAL-TIME WEBSOCKET HANDLERS
// ==========================================================================

socket.on('status', ({ status, qr }) => {
  if (!statusBadge) return;
  statusBadge.className = `ty-status-capsule ${status}`;

  if (status === 'connected') {
    statusLabel.innerText = 'WhatsApp Aktif (Bağlı)';
    if (qrCanvas) qrCanvas.style.display = 'none';
    if (qrPlaceholder) {
      qrPlaceholder.style.display = 'flex';
      qrPlaceholder.innerHTML = `
        <div style="color:var(--ty-green-500); font-size:32px; margin-bottom:4px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <span class="ty-qr-title" style="color:var(--ty-green-600);">WhatsApp Bağlandı</span>
        <span class="ty-qr-desc">Bot arka planda mesajları canlı dinliyor.</span>
      `;
    }
  } else if (status === 'qr_ready' && qr) {
    statusLabel.innerText = 'QR Kodu Okutun';
    if (qrPlaceholder) qrPlaceholder.style.display = 'none';
    if (qrCanvas) {
      qrCanvas.style.display = 'block';
      QRCode.toCanvas(qrCanvas, qr, { width: 180, margin: 1 });
    }
  } else {
    statusLabel.innerText = 'Bağlantı Kesildi';
    if (qrCanvas) qrCanvas.style.display = 'none';
    if (qrPlaceholder) {
      qrPlaceholder.style.display = 'flex';
      qrPlaceholder.innerHTML = `
        <div class="ty-modern-spinner"></div>
        <span class="ty-qr-title">Bağlantı Bekleniyor</span>
        <span class="ty-qr-desc">WhatsApp oturumu kuruluyor...</span>
      `;
    }
  }
});

socket.on('drivers_update', (drivers) => {
  allDrivers = drivers;
  updateStats(drivers);
  renderDriversTable();
});

socket.on('logs', (logs) => {
  if (!logs || logs.length === 0 || !logsList) return;
  logsList.innerHTML = '';
  logs.forEach(log => renderLogItem(log, false));
});

socket.on('new_message', (log) => {
  if (!logsList) return;
  const emptyState = logsList.querySelector('.ty-empty-stream');
  if (emptyState) emptyState.remove();
  renderLogItem(log, true);
});

socket.on('cutoff_update', (data) => {
  if (data && (data.cutoffTime || data.cutoffHour)) {
    currentCutoffTime = data.cutoffTime || `${String(data.cutoffHour).padStart(2, '0')}:00`;
    if (cutoffSelect) cutoffSelect.value = currentCutoffTime;
  }
});

// ==========================================================================
// KPI & METRICS UPDATE
// =================================================================function updateStats(drivers) {
  const total = drivers.length;
  const pending = drivers.filter(d => (!d.note || d.note.trim() === '')).length;
  const completed = drivers.filter(d => d.note && d.note.trim() !== '' && d.note !== 'GELMİYOR').length;
  const cancelled = drivers.filter(d => d.note === 'GELMİYOR').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Numeric KPI Cards
  const elTotal = document.getElementById('stat-total');
  const elPending = document.getElementById('stat-pending');
  const elCompleted = document.getElementById('stat-completed');
  const elCancelled = document.getElementById('stat-cancelled');
  const elCompletedPct = document.getElementById('stat-completed-pct');
  const elProgressComp = document.getElementById('stat-progress-completed');
  const elProgressPend = document.getElementById('stat-progress-pending');
  const elProgressCanc = document.getElementById('stat-progress-cancelled');

  if (elTotal) elTotal.innerText = total;
  if (elPending) elPending.innerText = pending;
  if (elCompleted) elCompleted.innerText = completed;
  if (elCancelled) elCancelled.innerText = cancelled;
  if (elCompletedPct) elCompletedPct.innerText = `%${pct} Tamamlandı`;
  if (elProgressComp) elProgressComp.style.width = `${pct}%`;
  if (elProgressPend) elProgressPend.style.width = `${total > 0 ? (pending / total) * 100 : 0}%`;
  if (elProgressCanc) elProgressCanc.style.width = `${total > 0 ? (cancelled / total) * 100 : 0}%`;

  // Tab count badges
  const bAll = document.getElementById('tab-badge-all');
  const bPend = document.getElementById('tab-badge-pending');
  const bComp = document.getElementById('tab-badge-completed');
  const bCanc = document.getElementById('tab-badge-cancelled');

  if (bAll) bAll.innerText = total;
  if (bPend) bPend.innerText = pending;
  if (bComp) bComp.innerText = completed;
  if (bCanc) bCanc.innerText = cancelled;

  // Footer summary
  const elFooter = document.getElementById('footer-count-info');
  if (elFooter) elFooter.innerText = `Toplam ${total} araç (${completed} saati alınan, ${pending} bekleyen, ${cancelled} gelmeyen/iptal)`;
}

// ==========================================================================
// SEARCH & FILTER
// ==========================================================================

function handleSearchFilter() {
  const input = document.getElementById('search-input');
  searchQuery = input ? input.value.toLowerCase().trim() : '';
  renderDriversTable();
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.ty-segmented-nav .ty-nav-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
  });
  renderDriversTable();
}

// Helper to get initials
function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Format Phone for Display
function formatPhone(phone) {
  const clean = (phone || '').replace(/[^0-9]/g, '');
  if (clean.length === 10) {
    return `0${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)}`;
  }
  if (clean.length === 11 && clean.startsWith('0')) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7, 9)} ${clean.slice(9, 11)}`;
  }
  if (clean.length === 12 && clean.startsWith('90')) {
    return `+90 ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)}`;
  }
  return phone || 'Telefon Yok';
}

// ==========================================================================
// RENDER FLEET TABLE
// ==========================================================================

function renderDriversTable() {
  if (!driversTbody) return;

  if (!allDrivers || allDrivers.length === 0) {
    driversTbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color: var(--ty-text-muted); padding: 56px 20px;">
          <div style="color: var(--ty-text-soft); margin-bottom: 10px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
          </div>
          <strong style="font-size: 15px; color: var(--ty-text-display);">Henüz sisteme şoför kaydı eklenmedi</strong>
          <p style="font-size: 12px; margin-top: 4px; color: var(--ty-text-soft);">Yukarıdaki <strong>"+ Yeni Şoför"</strong> butonunu kullanarak filo ekleyebilirsiniz.</p>
        </td>
      </tr>
    `;
    return;
  }

  const filtered = allDrivers.filter(d => {
    const dName = (d.driver || '').toLowerCase();
    const dPlate = (d.plate || '').toLowerCase();
    const dPhone = (d.phone || '').replace(/[^0-9]/g, '');

    const textMatch = !searchQuery || 
      dName.includes(searchQuery) ||
      dPlate.includes(searchQuery) ||
      dPhone.includes(searchQuery);

    if (!textMatch) return false;

    if (currentFilter === 'pending') {
      return !d.note || d.note.trim() === '';
    } else if (currentFilter === 'completed') {
      return d.note && d.note.trim() !== '' && d.note !== 'GELMİYOR';
    } else if (currentFilter === 'cancelled') {
      return d.note === 'GELMİYOR';
    }
    return true;
  });   return true;
  });

  driversTbody.innerHTML = '';

  if (filtered.length === 0) {
    driversTbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color: var(--ty-text-soft); padding: 40px 20px;">
          Aradığınız filtre veya kriterlere uygun araç bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(d => {
    const tr = document.createElement('tr');
    
    // Check Multi-Trip (1. Sefer / 2. Sefer)
    const cleanDigits = (d.phone || '').replace(/[^0-9]/g, '').slice(-10);
    const tripsCount = allDrivers.filter(x => (x.phone || '').replace(/[^0-9]/g, '').slice(-10) === cleanDigits).length;
    
    const isSecondTrip = (d.driver || '').includes('2. Sefer');
    let tripBadgeHtml = '';
    if (tripsCount > 1) {
      tripBadgeHtml = isSecondTrip 
        ? `<span class="ty-trip-indicator trip-2">2. Sefer</span>`
        : `<span class="ty-trip-indicator trip-1">1. Sefer</span>`;
    }

    // Driver Avatar + Name
    const driverInitials = getInitials(d.driver);
    const cleanDriverName = (d.driver || '').replace(/\(1\. Sefer\)|\(2\. Sefer\)/g, '').trim();

    // Plate Box (Authentic 3D TR Plate style)
    const rawPlate = (d.plate || 'PLAKASIZ').toUpperCase().trim();
    const plateHtml = `
      <div class="ty-plate-badge-3d" title="Araç Plakası: ${rawPlate}">
        <span class="ty-plate-tr-section">TR</span>
        <span class="ty-plate-text-code">${rawPlate}</span>
      </div>
    `;

    // ETA Chip
    let etaChipHtml = '';
    if (d.note === 'GELMİYOR') {
      etaChipHtml = `
        <span class="ty-eta-badge-interactive cancelled" onclick="openEtaModal(${d.id}, '${cleanDriverName}', 'GELMİYOR')" title="Durumu değiştirmek için tıklayın" style="background:#ef4444 !important; color:#ffffff !important; border:1px solid #dc2626 !important; font-weight:800; padding:5px 12px; border-radius:9999px; display:inline-flex; align-items:center; gap:5px; box-shadow:0 2px 8px rgba(239, 68, 68, 0.4);">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          <span style="color:#ffffff !important; font-weight:800;">GELMİYOR</span>
          <span class="ty-edit-spark" style="opacity:0.9;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>
        </span>
      `;
    } else if (d.note && d.note.trim() !== '') {
      etaChipHtml = `
        <span class="ty-eta-badge-interactive completed" onclick="openEtaModal(${d.id}, '${cleanDriverName}', '${d.note}')" title="Tahmini saati değiştirmek için tıklayın">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          ${d.note}
          <span class="ty-edit-spark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>
        </span>
      `;
    } else {
      etaChipHtml = `
        <span class="ty-eta-badge-interactive pending" onclick="openEtaModal(${d.id}, '${cleanDriverName}', '')" title="Hızlı saat girmek için tıklayın">
          <span>Bekleniyor</span>
          <span class="ty-edit-spark"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>
        </span>
      `;
    }

    // Action Buttons
    const actionHtml = d.asked 
      ? `
        <div class="ty-actions-cluster">
          <span class="ty-chip-sent-ok" title="WhatsApp sorusu şoföre iletildi">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Gönderildi
          </span>
          <button class="ty-btn-circle-action" onclick="askDriverEta(${d.id})" title="Şoföre Yeniden Soru Gönder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
          <button class="ty-btn-pill-trip" onclick="addDriverTrip(${d.id})" title="Bu şoför için 2. Sefer satırı aç">+ 2. Sefer</button>
          <button class="ty-btn-circle-action delete" onclick="deleteDriver(${d.id}, '${d.driver}')" title="Şoförü / Seferi Listeden Sil">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `
      : `
        <div class="ty-actions-cluster">
          <button class="ty-btn-wa-pulse" onclick="askDriverEta(${d.id})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.771-5.764-5.771z"/>
            </svg>
            WhatsApp'tan Sor
          </button>
          <button class="ty-btn-pill-trip" onclick="addDriverTrip(${d.id})" title="Bu şoför için 2. Sefer satırı aç">+ 2. Sefer</button>
          <button class="ty-btn-circle-action delete" onclick="deleteDriver(${d.id}, '${d.driver}')" title="Şoförü / Seferi Listeden Sil">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

    tr.innerHTML = `
      <td>
        <div class="ty-driver-cluster">
          <div class="ty-avatar-circle">${driverInitials}</div>
          <div class="ty-driver-text-meta">
            <span class="ty-name-bold">${cleanDriverName}</span>
            ${tripBadgeHtml}
          </div>
        </div>
      </td>
      <td>${plateHtml}</td>
      <td>
        <a href="tel:${d.phone}" class="ty-phone-chip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          <span>${formatPhone(d.phone)}</span>
        </a>
      </td>
      <td>${etaChipHtml}</td>
      <td style="text-align: right;">${actionHtml}</td>
    `;
    driversTbody.appendChild(tr);
  });
}

// ==========================================================================
// ACTIONS & API HANDLERS
// ==========================================================================

async function askDriverEta(driverId) {
  try {
    const res = await fetch('/api/send-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'WhatsApp sorusu iletildi', 'success');
    } else {
      showToast(data.message || 'Mesaj gönderilemedi', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

async function askAllPendingDrivers() {
  // Group trips by unique phone number
  const phoneMap = new Map();
  
  allDrivers.forEach(d => {
    const clean10 = (d.phone || '').replace(/[^0-9]/g, '').slice(-10);
    if (!phoneMap.has(clean10)) {
      phoneMap.set(clean10, []);
    }
    phoneMap.get(clean10).push(d);
  });

  // For each phone, select only the FIRST pending trip (1. Sefer first, 2. Sefer only if 1. Sefer has ETA)
  const targetDriversToAsk = [];
  phoneMap.forEach((trips) => {
    const sortedTrips = trips.slice().sort((a, b) => {
      const aIsSecond = (a.driver || '').includes('2. Sefer');
      const bIsSecond = (b.driver || '').includes('2. Sefer');
      return aIsSecond ? 1 : bIsSecond ? -1 : 0;
    });

    const firstPendingTrip = sortedTrips.find(t => !t.note || t.note.trim() === '');
    if (firstPendingTrip) {
      targetDriversToAsk.push(firstPendingTrip);
    }
  });

  if (targetDriversToAsk.length === 0) {
    showToast('Saat bekleyen şoför/sefer bulunamadı!', 'info');
    return;
  }

  showToast(`${targetDriversToAsk.length} şoföre (1. Sefer öncelikli) soru gönderiliyor...`, 'info');
  for (let i = 0; i < targetDriversToAsk.length; i++) {
    await askDriverEta(targetDriversToAsk[i].id);
    await new Promise(r => setTimeout(r, 400));
  }
  showToast('Soru mesajları başarıyla iletildi.', 'success');
}

async function addDriverTrip(driverId) {
  try {
    const res = await fetch('/api/drivers/add-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${data.driver.driver} sefer kaydı açıldı.`, 'success');
    } else {
      showToast(data.error || 'Sefer açılamadı', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

// Inline ETA Quick Modal Handlers
function openEtaModal(driverId, driverName, currentEta) {
  editingDriverId = driverId;
  const modal = document.getElementById('eta-modal');
  const nameEl = document.getElementById('eta-modal-driver-name');
  const inputEl = document.getElementById('eta-modal-custom-input');
  
  if (nameEl) nameEl.innerText = `${driverName} - Varış Saati`;
  if (inputEl) {
    inputEl.value = currentEta || '';
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveCustomEta();
      }
    };
  }
  if (modal) modal.style.display = 'flex';
  setTimeout(() => inputEl?.focus(), 30);
}

function closeEtaModal() {
  const modal = document.getElementById('eta-modal');
  if (modal) modal.style.display = 'none';
  editingDriverId = null;
}

function selectQuickTime(timeStr) {
  const inputEl = document.getElementById('eta-modal-custom-input');
  if (inputEl) inputEl.value = timeStr;
  saveCustomEta();
}

async function saveCustomEta() {
  if (!editingDriverId) return;
  const inputEl = document.getElementById('eta-modal-custom-input');
  const newEta = inputEl ? inputEl.value.trim() : '';

  try {
    const res = await fetch('/api/drivers/update-eta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: editingDriverId, eta: newEta })
    });
    const data = await res.json();
    if (data.success) {
      closeEtaModal();
      showToast('Varış saati başarıyla güncellendi.', 'success');
    } else {
      showToast(data.error || 'Güncelleme yapılamadı', 'error');
    }
  } catch (err) {
    showToast('Güncelleme hatası: ' + err.message, 'error');
  }
}

async function clearDriverEta() {
  if (!editingDriverId) return;

  try {
    const res = await fetch('/api/drivers/update-eta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: editingDriverId, eta: '' })
    });
    const data = await res.json();
    if (data.success) {
      closeEtaModal();
      showToast('Varış saati silindi, araç "Bekleniyor" durumuna alındı.', 'success');
    } else {
      showToast(data.error || 'Saat silinemedi', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

async function deleteDriver(driverId, driverName) {
  const confirmed = confirm(`"${driverName}" kaydını listeden silmek istediğinize emin misiniz?`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/drivers/${driverId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Şoför kaydı başarıyla silindi.', 'success');
    } else {
      showToast(data.error || 'Silme işlemi başarısız', 'error');
    }
  } catch (err) {
    showToast('Silme hatası: ' + err.message, 'error');
  }
}

async function confirmResetDay() {
  const confirmed = confirm('Tüm şoförlerin tahmini varış saatlerini ve durumlarını sıfırlamak istediğinize emin misiniz?');
  if (!confirmed) return;

  try {
    const res = await fetch('/api/reset-day', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Günün varış saatleri başarıyla sıfırlandı.', 'success');
    } else {
      showToast('Sıfırlama hatası: ' + (data.error || 'İşlem başarısız'), 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

async function handleCutoffChange(newTime) {
  try {
    const res = await fetch('/api/cutoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cutoffTime: newTime })
    });
    const data = await res.json();
    if (data.success) {
      currentCutoffTime = data.cutoffTime;
      showToast(`CUT-OFF saati ${data.cutoffTime} olarak güncellendi.`, 'success');
    } else {
      showToast('CUT-OFF güncellenemedi', 'error');
    }
  } catch (err) {
    showToast('Bağlantı hatası: ' + err.message, 'error');
  }
}

// Live Stream Item
function renderLogItem(log, prepend) {
  if (!logsList) return;
  const item = document.createElement('div');
  item.className = 'ty-stream-card';
  item.innerHTML = `
    <div class="ty-stream-head">
      <span class="ty-stream-author">${log.driverName || log.phone}</span>
      <span class="ty-stream-timestamp">${log.timestamp}</span>
    </div>
    <div class="ty-stream-bubble">${log.text}</div>
  `;

  if (prepend) {
    logsList.prepend(item);
  } else {
    logsList.appendChild(item);
  }
}

function clearLogs() {
  if (!logsList) return;
  logsList.innerHTML = `
    <div class="ty-empty-stream">
      <div class="ty-empty-icon-bubble">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <span>İşlem logları temizlendi</span>
      <small>Yeni WhatsApp yanıtları burada akacaktır.</small>
    </div>
  `;
  showToast('Loglar temizlendi', 'success');
}

// ==========================================================================
// CLIENT-SIDE EXCEL / CSV EXPORT
// ==========================================================================

function exportToExcel() {
  if (!allDrivers || allDrivers.length === 0) {
    showToast('Dışa aktarılacak şoför verisi bulunamadı!', 'error');
    return;
  }

  const headers = ['Sürücü Adı', 'Plaka', 'Telefon', 'Tahmini Varış (ETA)', 'Durum'];
  const rows = allDrivers.map(d => [
    `"${(d.driver || '').replace(/"/g, '""')}"`,
    `"${(d.plate || '').replace(/"/g, '""')}"`,
    `"${(d.phone || '').replace(/"/g, '""')}"`,
    `"${(d.note || '').replace(/"/g, '""')}"`,
    `"${d.note ? 'Saati Alındı' : 'Bekleniyor'}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trendyol_Ayazaga_Filo_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Excel/CSV dosyası başarıyla indirildi.', 'success');
}

// ==========================================================================
// MODAL CONTROLS
// ==========================================================================

function openDriverModal() {
  const modal = document.getElementById('driver-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => document.getElementById('input-driver')?.focus(), 50);
}

function closeDriverModal() {
  const modal = document.getElementById('driver-modal');
  if (modal) modal.style.display = 'none';
  const form = document.getElementById('add-driver-form');
  if (form) form.reset();
}

async function handleAddDriver(event) {
  event.preventDefault();
  const driver = document.getElementById('input-driver').value.trim();
  const plate = document.getElementById('input-plate').value.trim();
  const phone = document.getElementById('input-phone').value.trim();

  try {
    const res = await fetch('/api/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver, plate, phone })
    });
    const data = await res.json();
    if (data.success) {
      closeDriverModal();
      showToast(`${driver} başarıyla sisteme eklendi`, 'success');
    } else {
      showToast('Hata: ' + (data.error || 'Şoför eklenemedi'), 'error');
    }
  } catch (err) {
    showToast('Sunucu hatası: ' + err.message, 'error');
  }
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  let iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  if (type === 'error') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
  } else if (type === 'info') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  const toast = document.createElement('div');
  toast.className = `ty-toast-card ${type}`;
  toast.innerHTML = `
    <span style="display:inline-flex; align-items:center;">${iconSvg}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ==========================================================================
// SYSTEM CLOCK
// ==========================================================================

function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('tr-TR', { hour12: false });
  const dateStr = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });

  const elTime = document.getElementById('live-time');
  const elDate = document.getElementById('live-date');
  if (elTime) elTime.innerText = timeStr;
  if (elDate) elDate.innerText = dateStr;
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  }
  if (e.key === 'Escape') {
    closeDriverModal();
    closeEtaModal();
  }
});

// Initial startup
updateLiveClock();
setInterval(updateLiveClock, 1000);
