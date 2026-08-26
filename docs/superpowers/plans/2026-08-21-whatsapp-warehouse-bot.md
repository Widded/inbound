# WhatsApp Warehouse Driver ETA Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js & React/Web web application that automates WhatsApp driver notifications, parses ETA replies, and updates Column J ("NOT") in Google Sheets.

**Architecture:** Express backend handling WhatsApp Web QR authentication (via `@whiskeysockets/baileys` or `qrcode-terminal` / Socket.io / HTTP polling), Google Sheets API integration to sync driver data, and a clean Web UI showing WhatsApp QR code login, live driver status table, and message logs.

**Tech Stack:** Node.js, Express, `@whiskeysockets/baileys` / `whatsapp-web.js`, `googleapis`, Socket.io, Vite + React + Vanilla CSS.

## Global Constraints

- Full stack Node.js application in `c:\Users\harun\OneDrive\Desktop\inbound`
- Must read Google Sheet Columns: B (Sürücü), C (Plaka), D (İletişim), E (Giriş), F (Çıkış), J (Not)
- Must update Column J with parsed time string in `HH:MM` format

---

### Task 1: Time Parser Utility (Turkish Time Extraction)

**Files:**
- Create: `src/utils/timeParser.js`
- Test: `tests/timeParser.test.js`

**Interfaces:**
- Consumes: Raw text message string from WhatsApp driver
- Produces: `parseTurkishTime(text: string) => string | null` (returns "HH:MM" e.g., "16:30", or null)

- [ ] **Step 1: Write failing unit test**

Create `tests/timeParser.test.js`:
```javascript
const { parseTurkishTime } = require('../src/utils/timeParser');

test('parses standard HH:MM time', () => {
  expect(parseTurkishTime('16:30')).toBe('16:30');
  expect(parseTurkishTime('17.00')).toBe('17:00');
  expect(parseTurkishTime('Saat 5 gibi')).toBe('17:00');
  expect(parseTurkishTime('18 de oradayım')).toBe('18:00');
  expect(parseTurkishTime('merhaba')).toBe(null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/timeParser.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/timeParser.js`:
```javascript
function parseTurkishTime(text) {
  if (!text) return null;
  const str = text.trim().toLowerCase();
  
  // Match HH:MM or HH.MM (e.g., 16:30, 17.00, 09:15)
  const regexColonDot = /\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\b/;
  const matchColonDot = str.match(regexColonDot);
  if (matchColonDot) {
    const hours = matchColonDot[1].padStart(2, '0');
    const minutes = matchColonDot[2];
    return `${hours}:${minutes}`;
  }

  // Match single hour with words (e.g. "saat 5 gibi", "saat 17", "18 de")
  const regexSaatSingle = /(?:saat\s*)?([0-2]?[0-9])(?:\s*(?:de|da|te|ta|gibi|civarında))?/;
  const matchSaat = str.match(regexSaatSingle);
  if (matchSaat) {
    let hourNum = parseInt(matchSaat[1], 10);
    if (!isNaN(hourNum) && hourNum >= 1 && hourNum <= 24) {
      // If hour is 1..7 without 24h context, assume afternoon (e.g., 5 -> 17)
      if (hourNum >= 1 && hourNum <= 7 && str.includes('gibi')) {
        hourNum += 12;
      }
      if (hourNum >= 0 && hourNum <= 23) {
        return `${String(hourNum).padStart(2, '0')}:00`;
      }
    }
  }

  return null;
}

module.exports = { parseTurkishTime };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/timeParser.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/timeParser.js tests/timeParser.test.js
git commit -m "feat: add Turkish time parser utility for driver WhatsApp replies"
```

---

### Task 2: Google Sheets API Service

**Files:**
- Create: `src/sheets/googleSheets.js`
- Test: `tests/googleSheets.test.js`

**Interfaces:**
- Consumes: Google Sheet ID & Service Account credentials / API key or mock data
- Produces: 
  - `fetchDriversFromSheet(spreadsheetId, range)` -> Array of driver objects
  - `updateDriverEtaInSheet(spreadsheetId, rowIndex, etaTime)` -> Promise<boolean>

- [ ] **Step 1: Write failing test / mock sheet wrapper**

Create `src/sheets/googleSheets.js`:
```javascript
const { google } = require('googleapis');

class GoogleSheetsService {
  constructor(auth) {
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async fetchDrivers(spreadsheetId, range = 'Sheet1!A1:N50') {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = response.data.values || [];
    // Map rows starting from index 2 (1-based row index in Sheet)
    return rows.slice(1).map((row, idx) => ({
      rowIndex: idx + 2, // 1-based header is row 1
      driver: row[1] || '',      // Col B: Sürücü
      plate: row[2] || '',       // Col C: Plaka
      phone: row[3] || '',       // Col D: İletişim
      entry: row[4] || '',       // Col E: Giriş
      exit: row[5] || '',        // Col F: Çıkış
      ramp: row[6] || '',        // Col G: Rampa
      note: row[9] || '',        // Col J: NOT (ETA)
    }));
  }

  async updateEtaNote(spreadsheetId, rowIndex, etaTime, sheetName = 'Sheet1') {
    const range = `${sheetName}!J${rowIndex}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[etaTime]],
      },
    });
    return true;
  }
}

module.exports = GoogleSheetsService;
```

- [ ] **Step 2: Verify code syntax and exports**

Run: `node -e "require('./src/sheets/googleSheets.js')"`
Expected: No syntax errors

- [ ] **Step 3: Commit**

```bash
git add src/sheets/googleSheets.js
git commit -m "feat: add Google Sheets service integration"
```

---

### Task 3: WhatsApp Bot Client Service

**Files:**
- Create: `src/whatsapp/bot.js`
- Test: `tests/bot.test.js`

**Interfaces:**
- Consumes: Socket events, QR code callbacks, incoming messages
- Produces: `initWhatsAppBot(onQr, onMessage)` handler

- [ ] **Step 1: Create WhatsApp bot service module**

Create `src/whatsapp/bot.js`:
```javascript
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

async function connectToWhatsApp(onQr, onMessage, onStatusChange) {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && onQr) {
      onQr(qr);
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (onStatusChange) onStatusChange('disconnected');
      if (shouldReconnect) {
        connectToWhatsApp(onQr, onMessage, onStatusChange);
      }
    } else if (connection === 'open') {
      if (onStatusChange) onStatusChange('connected');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && onMessage) {
          await onMessage(sock, msg);
        }
      }
    }
  });

  return sock;
}

module.exports = { connectToWhatsApp };
```

- [ ] **Step 2: Commit**

```bash
git add src/whatsapp/bot.js
git commit -m "feat: add WhatsApp Baileys integration module"
```

---

### Task 4: Express Web Server & Real-time Web Dashboard

**Files:**
- Create: `src/server.js`
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Serves Web Dashboard UI
- Emits real-time QR code, status logs, driver sync status via WebSocket / Socket.io
- API endpoints: `GET /api/drivers`, `POST /api/send-questions`, `POST /api/settings`

- [ ] **Step 1: Create Express + Socket.io Server**

Create `src/server.js`:
```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { parseTurkishTime } = require('./utils/timeParser');
const { connectToWhatsApp } = require('./whatsapp/bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let waSocket = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let driverLogs = [];

// API Routes
app.get('/api/status', (req, res) => {
  res.json({ status: connectionStatus, qr: qrCodeData });
});

io.on('connection', (socket) => {
  socket.emit('status', { status: connectionStatus, qr: qrCodeData });
  socket.emit('logs', driverLogs);
});

// Initialize WhatsApp
connectToWhatsApp(
  (qr) => {
    qrCodeData = qr;
    connectionStatus = 'qr_ready';
    io.emit('status', { status: connectionStatus, qr });
  },
  async (sock, msg) => {
    const sender = msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const parsedTime = parseTurkishTime(text);

    const logEntry = {
      timestamp: new Date().toLocaleTimeString('tr-TR'),
      phone: sender.replace('@s.whatsapp.net', ''),
      text,
      parsedTime,
    };
    driverLogs.unshift(logEntry);
    io.emit('new_message', logEntry);

    if (parsedTime) {
      await sock.sendMessage(sender, {
        text: `Teşekkürler! Tahmini varış saatiniz (${parsedTime}) sistemimize kaydedildi. 👍`,
      });
    }
  },
  (status) => {
    connectionStatus = status;
    if (status === 'connected') qrCodeData = null;
    io.emit('status', { status, qr: qrCodeData });
  }
).then((sock) => {
  waSocket = sock;
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Create Web Dashboard UI (`public/index.html` & `public/style.css`)**

Create `public/index.html`:
```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Depo WhatsApp Bot & ETA Yönetim Paneli</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <div class="dashboard">
    <header class="navbar">
      <h1>🚚 Depo Şoför ETA & WhatsApp Bot Paneli</h1>
      <div id="status-badge" class="badge disconnected">Bağlantı Kesildi</div>
    </header>

    <main class="content-grid">
      <section class="card qr-section">
        <h2>📱 WhatsApp Bağlantısı</h2>
        <p>Aşağıdaki QR kodu WhatsApp mobil uygulamanızdan okutun:</p>
        <div id="qr-container">
          <canvas id="qr-canvas"></canvas>
          <div id="qr-placeholder">QR Yükleniyor...</div>
        </div>
      </section>

      <section class="card logs-section">
        <h2>💬 Gelen Şoför Mesajları & Canlı Durum</h2>
        <div id="logs-list" class="logs-list">
          <div class="empty-state">Henüz mesaj gelmedi...</div>
        </div>
      </section>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

Create `public/style.css` with sleek dark glassmorphic modern styling:
```css
:root {
  --bg-main: #0f172a;
  --card-bg: rgba(30, 41, 59, 0.7);
  --border: #334155;
  --accent: #3b82f6;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: var(--bg-main);
  color: var(--text-main);
  margin: 0;
  padding: 20px;
}

.dashboard {
  max-width: 1200px;
  margin: 0 auto;
}

.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  background: var(--card-bg);
  padding: 16px 24px;
  border-radius: 12px;
  border: 1px solid var(--border);
}

.badge {
  padding: 6px 16px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 14px;
}
.badge.connected { background: var(--success); color: #fff; }
.badge.disconnected { background: var(--danger); color: #fff; }
.badge.qr_ready { background: var(--warning); color: #000; }

.content-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 20px;
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  backdrop-filter: blur(10px);
}

#qr-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 250px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-top: 12px;
}

#qr-canvas {
  border-radius: 8px;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 400px;
  overflow-y: auto;
}

.log-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.parsed-badge {
  background: var(--accent);
  color: #fff;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: bold;
}
```

Create `public/app.js`:
```javascript
const socket = io();
const statusBadge = document.getElementById('status-badge');
const qrCanvas = document.getElementById('qr-canvas');
const qrPlaceholder = document.getElementById('qr-placeholder');
const logsList = document.getElementById('logs-list');

socket.on('status', ({ status, qr }) => {
  statusBadge.className = `badge ${status}`;
  if (status === 'connected') {
    statusBadge.innerText = 'Bağlı (Aktif)';
    qrCanvas.style.display = 'none';
    qrPlaceholder.style.display = 'block';
    qrPlaceholder.innerText = '✅ WhatsApp Bağlandı!';
  } else if (status === 'qr_ready' && qr) {
    statusBadge.innerText = 'QR Kodu Okutun';
    qrPlaceholder.style.display = 'none';
    qrCanvas.style.display = 'block';
    QRCode.toCanvas(qrCanvas, qr, { width: 220 });
  } else {
    statusBadge.innerText = 'Bağlantı Kesildi';
    qrCanvas.style.display = 'none';
    qrPlaceholder.style.display = 'block';
    qrPlaceholder.innerText = 'Yükleniyor...';
  }
});

socket.on('logs', renderLogs);
socket.on('new_message', (log) => {
  renderLogItem(log, true);
});

function renderLogs(logs) {
  if (!logs || logs.length === 0) return;
  logsList.innerHTML = '';
  logs.forEach(log => renderLogItem(log, false));
}

function renderLogItem(log, prepend) {
  const item = document.createElement('div');
  item.className = 'log-item';
  item.innerHTML = `
    <div>
      <strong>📱 ${log.phone}</strong> <small style="color:#94a3b8">${log.timestamp}</small>
      <div>"${log.text}"</div>
    </div>
    ${log.parsedTime ? `<div class="parsed-badge">ETA: ${log.parsedTime}</div>` : ''}
  `;
  if (prepend) {
    logsList.prepend(item);
  } else {
    logsList.appendChild(item);
  }
}
```

- [ ] **Step 3: Commit Dashboard & Server**

```bash
git add src/server.js public/index.html public/style.css public/app.js
git commit -m "feat: add Express server and web dashboard for WhatsApp QR and live logs"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-whatsapp-warehouse-bot.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
