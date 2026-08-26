require('dotenv').config();

class GoogleSheetsService {
  constructor() {
    this.webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';
  }

  async updateDriverEtaInSheet(plate, phone, etaTime, tripLabel = '') {
    const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL || this.webhookUrl;
    if (!url) return false;

    try {
      const payload = {
        plate: plate || '',
        phone: phone || '',
        eta: etaTime || '',
        trip: tripLabel || ''
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);
      console.log(`📊 Google Sheets Webhook updated: ${plate || phone} -> ${etaTime}`, data || '');
      return true;
    } catch (err) {
      console.error('Google Sheets Webhook sync notice:', err.message);
    }
    return false;
  }

  async clearAllEtasInSheet() {
    const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL || this.webhookUrl;
    if (!url) return false;

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      console.log('📊 Google Sheets Webhook: Daily reset signal sent.');
      return true;
    } catch (err) {
      console.error('Google Sheets Webhook reset notice:', err.message);
    }
    return false;
  }
}

module.exports = new GoogleSheetsService();
