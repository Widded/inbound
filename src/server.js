process.on('unhandledRejection', (reason) => {
  console.log('[Baileys Notice - unhandledRejection]:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.log('[Baileys Notice - uncaughtException]:', err?.message || err);
});

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { parseTurkishTime } = require('./utils/timeParser');
const { connectToWhatsApp } = require('./whatsapp/bot');
const { fetchDriversFromDb, insertDriverToDb, updateDriverEtaInDb, clearAllDriverEtasInDb, deleteDriverFromDb } = require('./db/supabase');
const googleSheetsService = require('./sheets/googleSheets');

// LID to Phone Number Map (WhatsApp Multi-Device LID Resolver)
const lidToPhoneMap = new Map();

async function resetDay() {
  driversList.forEach(d => {
    d.note = '';
    d.asked = false;
  });
  await clearAllDriverEtasInDb();
  await googleSheetsService.clearAllEtasInSheet();

  const logEntry = {
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    phone: 'SYSTEM',
    driverName: 'Sistem',
    text: 'Günlük varış saatleri sıfırlandı.',
    parsedTime: null,
  };
  driverLogs.unshift(logEntry);

  io.emit('drivers_update', driversList);
  io.emit('new_message', logEntry);
  console.log('🗓️ Daily reset performed (00:00 midnight or manual action).');
}

function scheduleMidnightReset() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const msToMidnight = nextMidnight.getTime() - now.getTime();

  console.log(`⏰ Scheduled next daily reset in ${Math.round(msToMidnight / 1000 / 60)} minutes (at 00:00).`);

  setTimeout(async () => {
    await resetDay();
    scheduleMidnightReset();
  }, msToMidnight);
}
scheduleMidnightReset();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let cutoffHour = 19;

app.post('/api/reset-day', async (req, res) => {
  await resetDay();
  res.json({ success: true, message: 'Günü sıfırlama işlemi başarıyla tamamlandı.' });
});

app.get('/api/cutoff', (req, res) => {
  res.json({ cutoffHour });
});

app.post('/api/cutoff', (req, res) => {
  const { hour } = req.body;
  const parsed = parseInt(hour, 10);
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 23) {
    cutoffHour = parsed;
    io.emit('cutoff_update', { cutoffHour });
    console.log(`⏱️ Cut-off hour updated to ${cutoffHour}:00.`);
    return res.json({ success: true, cutoffHour });
  }
  res.status(400).json({ error: 'Geçersiz saat' });
});

let waSocket = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let driverLogs = [];
let driversList = [];

// Load drivers directly from Supabase DB
async function syncDriversFromDb() {
  const dbDrivers = await fetchDriversFromDb();
  if (dbDrivers && Array.isArray(dbDrivers)) {
    driversList = dbDrivers.map(d => ({
      id: d.id,
      driver: d.driver,
      plate: d.plate,
      phone: d.phone,
      entry: d.entry || '*',
      exit: d.exit || '*',
      ramp: d.ramp || '*',
      note: d.note || ''
    }));
    io.emit('drivers_update', driversList);
    console.log(`Synced ${driversList.length} drivers directly from Supabase database.`);
  }
}
syncDriversFromDb();

app.get('/api/status', (req, res) => {
  res.json({ status: connectionStatus, qr: qrCodeData });
});

app.get('/api/drivers', async (req, res) => {
  await syncDriversFromDb();
  res.json(driversList);
});

app.post('/api/drivers', async (req, res) => {
  const { driver, plate, phone, entry = '*', exit = '*', ramp = '*', note = '' } = req.body;
  if (!driver || !phone) {
    return res.status(400).json({ error: 'Sürücü adı ve telefon zorunludur' });
  }

  const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
  const driverObj = {
    driver: driver.trim(),
    plate: plate ? plate.trim() : '',
    phone: cleanPhone,
    entry,
    exit,
    ramp,
    note
  };

  // Insert to Supabase DB
  const dbResult = await insertDriverToDb(driverObj);
  const newDriver = dbResult ? {
    id: dbResult.id,
    driver: dbResult.driver,
    plate: dbResult.plate,
    phone: dbResult.phone,
    entry: dbResult.entry,
    exit: dbResult.exit,
    ramp: dbResult.ramp,
    note: dbResult.note
  } : {
    id: Date.now(),
    ...driverObj
  };

  driversList.unshift(newDriver);
  io.emit('drivers_update', driversList);
  res.json({ success: true, driver: newDriver });
});

app.post('/api/drivers/add-trip', async (req, res) => {
  const { driverId } = req.body;
  const originalDriver = driversList.find(d => d.id === driverId || d.id == driverId);
  if (!originalDriver) {
    return res.status(404).json({ error: 'Sürücü bulunamadı' });
  }

  const cleanPhone = originalDriver.phone.replace(/[^0-9]/g, '');
  const existingTrips = driversList.filter(d => d.phone.replace(/[^0-9]/g, '').slice(-10) === cleanPhone.slice(-10));
  const tripNum = existingTrips.length + 1;

  const baseName = originalDriver.driver.replace(/\s*\(\d+\.\s*Sefer\)/g, '').trim();
  const newDriverObj = {
    driver: `${baseName} (${tripNum}. Sefer)`,
    plate: originalDriver.plate,
    phone: cleanPhone,
    entry: '*',
    exit: '*',
    ramp: '*',
    note: ''
  };

  const dbResult = await insertDriverToDb(newDriverObj);
  const newDriver = dbResult ? {
    id: dbResult.id,
    driver: dbResult.driver,
    plate: dbResult.plate,
    phone: dbResult.phone,
    entry: dbResult.entry,
    exit: dbResult.exit,
    ramp: dbResult.ramp,
    note: dbResult.note,
    asked: false
  } : {
    id: Date.now(),
    ...newDriverObj,
    asked: false
  };

  driversList.unshift(newDriver);
  io.emit('drivers_update', driversList);
  res.json({ success: true, driver: newDriver });
});

app.post('/api/drivers/update-eta', async (req, res) => {
  const { driverId, eta } = req.body;
  const targetDriver = driversList.find(d => d.id === driverId || d.id == driverId);
  if (!targetDriver) {
    return res.status(404).json({ error: 'Sürücü bulunamadı' });
  }

  const cleanTime = eta ? (parseTurkishTime(eta) || eta.trim()) : '';
  targetDriver.note = cleanTime;

  const cleanPhone = targetDriver.phone.replace(/[^0-9]/g, '');
  if (cleanPhone) {
    const tripLabel = (targetDriver.driver || '').includes('2. Sefer') ? '2. Sefer' : '';
    await updateDriverEtaInDb(cleanPhone.slice(-10), cleanTime);
    await googleSheetsService.updateDriverEtaInSheet(targetDriver.plate, targetDriver.phone, cleanTime, tripLabel);
  }

  io.emit('drivers_update', driversList);
  res.json({ success: true, driver: targetDriver });
});

app.delete('/api/drivers/:id', async (req, res) => {
  const driverId = req.params.id;
  const index = driversList.findIndex(d => d.id == driverId);
  if (index === -1) {
    return res.status(404).json({ error: 'Sürücü bulunamadı' });
  }

  const removedDriver = driversList.splice(index, 1)[0];
  await deleteDriverFromDb(driverId);

  const logEntry = {
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    phone: removedDriver.phone,
    driverName: removedDriver.driver,
    text: `Kayıt Silindi: ${removedDriver.driver} (${removedDriver.plate || 'Plakasız'})`,
    parsedTime: null
  };
  driverLogs.unshift(logEntry);

  io.emit('drivers_update', driversList);
  io.emit('new_message', logEntry);
  res.json({ success: true, message: 'Şoför/sefer başarıyla silindi' });
});

app.post('/api/send-question', async (req, res) => {
  const { driverId } = req.body;
  const targetDriver = driversList.find(d => d.id === driverId || d.id == driverId);
  if (!targetDriver) {
    return res.status(404).json({ error: 'Driver not found' });
  }

  let success = false;
  let statusDetail = 'WhatsApp bağlı değil';

  if (waSocket && connectionStatus === 'connected') {
    try {
      let rawPhone = targetDriver.phone.replace(/[^0-9]/g, '');
      if (rawPhone.startsWith('0')) {
        rawPhone = '90' + rawPhone.slice(1);
      } else if (rawPhone.length === 10) {
        rawPhone = '90' + rawPhone;
      }

      const cleanPhone10 = rawPhone.slice(-10);

      // Check WhatsApp registration and get EXACT target JID & LID mapping
      let targetJid = rawPhone + '@s.whatsapp.net';
      try {
        const [onWaResult] = await waSocket.onWhatsApp(rawPhone);
        console.log('[onWhatsApp Query Result]:', onWaResult);
        if (onWaResult && onWaResult.exists) {
          if (onWaResult.jid) targetJid = onWaResult.jid;
          if (onWaResult.lid) {
            lidToPhoneMap.set(onWaResult.lid, cleanPhone10);
            lidToPhoneMap.set(onWaResult.lid.split('@')[0], cleanPhone10);
            console.log(`[LID Mapped] ${onWaResult.lid} -> ${cleanPhone10}`);
          }
        }
      } catch (checkErr) {
        console.log('onWhatsApp check notice:', checkErr.message);
      }

      // Check if this driver has multiple trips
      const allMatchingTrips = driversList.filter(d => d.phone.replace(/[^0-9]/g, '').slice(-10) === cleanPhone10);
      const hasMultipleTrips = allMatchingTrips.length > 1;

      let driverDisplayName = (targetDriver.driver || 'Sürücü').trim();
      if (hasMultipleTrips && !driverDisplayName.includes('Sefer')) {
        driverDisplayName = `${driverDisplayName} (1. Sefer)`;
      }

      const plateStr = targetDriver.plate && targetDriver.plate.trim() ? `${targetDriver.plate.trim()} plakalı araç ile ` : '';
      const messageText = `Merhaba Sayın ${driverDisplayName}, ${plateStr}Ayazağa KM depomuza tahmini varış saatiniz nedir?`;

      console.log(`[Outgoing WhatsApp Message] -> To JID: ${targetJid} | Content: "${messageText}"`);
      await waSocket.sendMessage(targetJid, { text: messageText }, { ephemeralExpiration: 0 });
      success = true;
      targetDriver.asked = true;
      targetDriver.askedAt = Date.now();
      statusDetail = 'Mesaj başarıyla gönderildi';
    } catch (err) {
      console.error('Error sending WhatsApp message:', err);
      statusDetail = 'Gönderim hatası: ' + err.message;
    }
  }

  const plateLabel = targetDriver.plate && targetDriver.plate.trim() ? ` (${targetDriver.plate.trim()})` : '';
  const log = {
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    phone: targetDriver.phone,
    driverName: `${targetDriver.driver}${plateLabel}`,
    text: `Soru Gönderildi -> ${targetDriver.driver}${plateLabel} [${statusDetail}]`,
    parsedTime: null
  };
  driverLogs.unshift(log);
  io.emit('new_message', log);
  io.emit('drivers_update', driversList);

  res.json({ success, message: statusDetail });
});

io.on('connection', (socket) => {
  socket.emit('status', { status: connectionStatus, qr: qrCodeData });
  socket.emit('logs', driverLogs);
  socket.emit('drivers_update', driversList);
  socket.emit('cutoff_update', { cutoffHour });
});

function extractPhoneFromMsg(msg) {
  const remoteJid = msg.key?.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) return null;

  // 1. Check LID mapping directly
  if (lidToPhoneMap.has(remoteJid)) {
    return lidToPhoneMap.get(remoteJid);
  }
  const rawLid = remoteJid.split('@')[0];
  if (lidToPhoneMap.has(rawLid)) {
    return lidToPhoneMap.get(rawLid);
  }

  const candidates = [
    msg.key?.senderPn,
    msg.key?.participantPn,
    msg.key?.remoteJidAlt,
    msg.key?.participant,
    remoteJid,
    msg.participant,
    msg.message?.extendedTextMessage?.contextInfo?.participant
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && !c.endsWith('@g.us')) {
      if (lidToPhoneMap.has(c)) {
        return lidToPhoneMap.get(c);
      }
      if (c.includes('@s.whatsapp.net')) {
        const digits = c.split('@')[0].replace(/[^0-9]/g, '');
        if (digits.length >= 10) return digits;
      } else if (!c.includes('@lid')) {
        const digits = c.replace(/[^0-9]/g, '');
        if (digits.length >= 10) return digits;
      }
    }
  }
  return null;
}

connectToWhatsApp(
  (qr) => {
    qrCodeData = qr;
    connectionStatus = 'qr_ready';
    io.emit('status', { status: connectionStatus, qr });
  },
  async (sock, msg) => {
    // TRIPLE SAFETY SHIELD: Completely ignore groups, status updates, and broadcasts
    const rJid = msg.key?.remoteJid || '';
    const pJid = msg.key?.participant || '';
    if (rJid.includes('@g.us') || pJid.includes('@g.us') || rJid.includes('@broadcast')) {
      return;
    }
    const text = 
      msg.message?.conversation || 
      msg.message?.extendedTextMessage?.text || 
      msg.message?.imageMessage?.caption || 
      msg.message?.videoMessage?.caption || 
      '';

    console.log(`[Incoming Message Raw] JID: ${msg.key?.remoteJid} | senderPn: ${msg.key?.senderPn} | participant: ${msg.key?.participant} | Text: "${text}"`);

    const parsedTime = parseTurkishTime(text);
    if (!parsedTime) {
      console.log(`[Incoming Message] No ETA time parsed from: "${text}"`);
      return;
    }

    const cleanPhoneDigits = extractPhoneFromMsg(msg);
    console.log(`[Incoming Message Extracted Phone] Digits: ${cleanPhoneDigits}`);

    let matchingDriver = null;
    if (cleanPhoneDigits) {
      const last10 = cleanPhoneDigits.slice(-10);
      const matchingDrivers = driversList.filter(d => {
        const dDigits = d.phone.replace(/[^0-9]/g, '').slice(-10);
        return dDigits.length > 5 && dDigits === last10;
      });

      if (matchingDrivers.length > 0) {
        // 1. If a question was asked specifically for a trip row (has askedAt), route reply to that trip
        const recentlyAsked = matchingDrivers
          .filter(d => d.askedAt)
          .sort((a, b) => (b.askedAt || 0) - (a.askedAt || 0));

        if (recentlyAsked.length > 0) {
          matchingDriver = recentlyAsked[0];
        } else {
          // 2. Default: Prefer the 1st primary trip row, or pending trip
          const pendingTrip = matchingDrivers.slice().reverse().find(d => !d.note);
          matchingDriver = pendingTrip || matchingDrivers[matchingDrivers.length - 1];
        }
      }
    }

    // Smart fallback if phone couldn't be extracted from LID
    if (!matchingDriver) {
      const askedRecently = driversList
        .filter(d => d.asked && d.askedAt && (Date.now() - d.askedAt) < 1000 * 60 * 60 * 4)
        .sort((a, b) => (b.askedAt || 0) - (a.askedAt || 0));

      if (askedRecently.length === 1) {
        matchingDriver = askedRecently[0];
        console.log(`[Smart Fallback Match] Matched to recently asked driver: ${matchingDriver.driver}`);
      } else if (driversList.length === 1) {
        matchingDriver = driversList[0];
        console.log(`[Single Driver Fallback Match] Matched to only driver in system: ${matchingDriver.driver}`);
      }
    }

    if (!matchingDriver) {
      console.log(`[Incoming Message Ignored] Phone ${cleanPhoneDigits} not registered in drivers list.`);
      return;
    }

    // The recipient JID for replying MUST BE msg.key.remoteJid to match the active Signal session
    const replyJid = msg.key.remoteJid;

    // DYNAMIC CUT-OFF RULE 2: Do not accept responses after cutoff hour system time!
    const now = new Date();
    const currentHour = now.getHours();
    const cutoffStr = String(cutoffHour).padStart(2, '0') + ':00';

    if (currentHour >= cutoffHour) {
      const closedReply = `Sayın ${matchingDriver.driver}, mesai saatlerimiz (${cutoffStr}) sona erdiğinden dolayı tahmini varış saati kabul edilmemektedir.`;
      console.log(`[WhatsApp Reply Closed] -> JID: ${replyJid} | Content: "${closedReply}"`);
      await sock.sendMessage(replyJid, { text: String(closedReply) }, { ephemeralExpiration: 0 });
      return;
    }

    // DYNAMIC CUT-OFF RULE 3: Do not accept ETA times past cutoff hour! (e.g. ETA > cutoffStr)
    if (parsedTime > cutoffStr) {
      const lateEtaReply = `Sayın ${matchingDriver.driver}, saat ${cutoffStr}'dan sonraki varış saatleri kabul edilmemektedir.`;
      console.log(`[WhatsApp Reply Late ETA] -> JID: ${replyJid} | ETA: ${parsedTime}`);
      await sock.sendMessage(replyJid, { text: String(lateEtaReply) }, { ephemeralExpiration: 0 });
      return;
    }

    let isUpdate = false;
    let oldTime = matchingDriver.note;
    isUpdate = Boolean(oldTime && oldTime !== parsedTime);
    matchingDriver.note = parsedTime;
    io.emit('drivers_update', driversList);

    // Sync ETA update directly to Supabase DB & Google Sheets
    const effectivePhoneDigits = cleanPhoneDigits || matchingDriver.phone.replace(/[^0-9]/g, '');
    if (effectivePhoneDigits) {
      const tripLabel = (matchingDriver.driver || '').includes('2. Sefer') ? '2. Sefer' : '';
      await updateDriverEtaInDb(effectivePhoneDigits.slice(-10), parsedTime);
      await googleSheetsService.updateDriverEtaInSheet(matchingDriver.plate, matchingDriver.phone, parsedTime, tripLabel);
    }

    const driverInfo = `${matchingDriver.driver} (${matchingDriver.plate || 'Plakasız'})`;

    const logText = isUpdate
      ? `Tahmini Saati Güncelledi: ${parsedTime} (Eski: ${oldTime})`
      : `Tahmini Varış Saati Alındı: ${parsedTime}`;

    const logEntry = {
      timestamp: new Date().toLocaleTimeString('tr-TR'),
      phone: matchingDriver.phone,
      driverName: driverInfo,
      text: logText,
      parsedTime,
    };
    driverLogs.unshift(logEntry);
    io.emit('new_message', logEntry);

    const allMatchingTrips = driversList.filter(d => {
      const dDigits = d.phone.replace(/[^0-9]/g, '').slice(-10);
      return dDigits.length > 5 && dDigits === matchingDriver.phone.replace(/[^0-9]/g, '').slice(-10);
    });
    const hasMultipleTrips = allMatchingTrips.length > 1;

    let driverDisplayName = (matchingDriver.driver || 'Sürücü').trim();
    if (hasMultipleTrips && !driverDisplayName.includes('Sefer')) {
      driverDisplayName = `${driverDisplayName} (1. Sefer)`;
    }

    const replyText = isUpdate
      ? `Teşekkürler Sayın ${driverDisplayName}! Tahmini varış saatiniz (${parsedTime}) olarak güncellendi.`
      : `Teşekkürler Sayın ${driverDisplayName}! Tahmini varış saatiniz (${parsedTime}) olarak sisteme kaydedildi.`;

    console.log(`[WhatsApp Reply Sent] -> JID: ${replyJid} | Content: "${replyText}"`);
    await sock.sendMessage(replyJid, { text: String(replyText) }, { ephemeralExpiration: 0 });

    // SEQUENTIAL 2ND TRIP QUERY:
    // If 1. Sefer was answered and the driver has an unasked/pending 2. Sefer:
    const isFirstTrip = !((matchingDriver.driver || '').includes('2. Sefer'));
    if (isFirstTrip && hasMultipleTrips) {
      const secondTrip = allMatchingTrips.find(d => (d.driver || '').includes('2. Sefer') && (!d.note || d.note.trim() === ''));
      if (secondTrip) {
        setTimeout(async () => {
          try {
            const rawBaseName = matchingDriver.driver.replace(/\s*\(\d+\.\s*Sefer\)/g, '').trim();
            const plateStr = secondTrip.plate && secondTrip.plate.trim() ? `${secondTrip.plate.trim()} plakalı araç ile ` : '';
            const secondQuestionText = `Sayın ${rawBaseName}, ayrıca (2. Sefer) ${plateStr}Ayazağa KM depomuza tahmini varış saatiniz nedir?`;
            
            console.log(`[Auto 2. Sefer Question] -> To JID: ${replyJid} | Content: "${secondQuestionText}"`);
            await sock.sendMessage(replyJid, { text: String(secondQuestionText) }, { ephemeralExpiration: 0 });
            secondTrip.asked = true;
            secondTrip.askedAt = Date.now();

            const plateLabel = secondTrip.plate && secondTrip.plate.trim() ? ` (${secondTrip.plate.trim()})` : '';
            const logEntry2 = {
              timestamp: new Date().toLocaleTimeString('tr-TR'),
              phone: secondTrip.phone,
              driverName: `${secondTrip.driver}${plateLabel}`,
              text: `Otomatik 2. Sefer Soruldu -> ${secondTrip.driver}${plateLabel}`,
              parsedTime: null,
            };
            driverLogs.unshift(logEntry2);
            io.emit('new_message', logEntry2);
            io.emit('drivers_update', driversList);
          } catch (e) {
            console.error('Error auto asking 2. Sefer:', e);
          }
        }, 2500);
      }
    }
  },
  (status) => {
    connectionStatus = status;
    if (status === 'connected') qrCodeData = null;
    io.emit('status', { status, qr: qrCodeData });
  },
  (sock) => {
    waSocket = sock;
  }
);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
