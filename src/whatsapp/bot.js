const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const logger = pino({ level: 'silent' });
const sentMessagesStore = new Map();

async function connectToWhatsApp(onQr, onMessage, onStatusChange, onSocketReady) {
  try {
    const authDir = path.resolve('baileys_auth_info');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WhatsApp Web protocol version v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: Browsers.windows('Desktop'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: undefined,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      getMessage: async (key) => {
        if (key && key.id && sentMessagesStore.has(key.id)) {
          return sentMessagesStore.get(key.id);
        }
        return undefined;
      }
    });

    // Wrap sendMessage to automatically track all sent messages for proper retries
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const result = await originalSendMessage(...args);
      if (result && result.key && result.key.id) {
        const content = args[1];
        if (content && content.text) {
          sentMessagesStore.set(result.key.id, { conversation: content.text });
        }
      }
      return result;
    };

    if (onSocketReady) {
      onSocketReady(sock);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && onQr) {
        console.log('⚡ Fresh QR Code Generated for Dashboard scan.');
        onQr(qr);
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`[WhatsApp Connection Closed] Status: ${statusCode}`);
        if (onStatusChange) onStatusChange('disconnected');

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('🔴 Device was logged out. Cleaning old session to generate fresh QR...');
          try {
            if (fs.existsSync(authDir)) {
              fs.rmSync(authDir, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('Error removing auth dir:', e);
          }
          setTimeout(() => connectToWhatsApp(onQr, onMessage, onStatusChange, onSocketReady), 1500);
        } else {
          setTimeout(() => connectToWhatsApp(onQr, onMessage, onStatusChange, onSocketReady), 3000);
        }
      } else if (connection === 'open') {
        console.log('🟢 WhatsApp Connection Opened Successfully.');
        if (onStatusChange) onStatusChange('connected');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify' || m.type === 'append') {
        for (const msg of m.messages) {
          if (!msg.key?.fromMe && onMessage) {
            await onMessage(sock, msg);
          }
        }
      }
    });

    return sock;
  } catch (err) {
    console.error('WhatsApp Connection Error:', err);
    if (onStatusChange) onStatusChange('disconnected');
    setTimeout(() => connectToWhatsApp(onQr, onMessage, onStatusChange, onSocketReady), 3000);
    return null;
  }
}

module.exports = { connectToWhatsApp, sentMessagesStore };
