# WhatsApp Depo Şoför ETA (Tahmini Geliş Saati) Botu ve Yönetim Paneli Tasarım Dokümanı

**Tarih:** 2026-08-21  
**Proje:** Depo Şoför Takip ve Otomatik WhatsApp Geliş Saati Bildirim Sistemi

---

## 1. Amaç ve Özet
Depo operasyonlarında şoförleri tek tek telefonla arayıp tahmini varış saatini öğrenme sürecini tamamen otomatikleştirmek. Elemanın arama yapma ihtiyacını ortadan kaldırarak, Google E-Tablo'daki **NOT (Tahmini Geliş Saati)** sütununun şoförlerden WhatsApp üzerinden gelen yanıtlarla otomatik güncellenmesini sağlamak.

---

## 2. Sistem Mimarisi

```
  +-------------------------------------------------------+
  |              Depo Yönetim Paneli (Web UI)             |
  |  - QR Kod Bağlantı Ekranı                              |
  |  - Canlı Şoför Takip Ekranı                            |
  |  - Mesaj Gönderim Logları                              |
  +--------------------------+----------------------------+
                             |
                             v
  +-------------------------------------------------------+
  |               Node.js Backend Sunucusu                |
  |  - Baileys / WhatsApp Web Oturum Yöneticisi          |
  |  - Türkçe Saat Ayıklayıcı (Regex / Parser)            |
  |  - Google Sheets API Senkronizasyon Servisi           |
  +--------------------------+----------------------------+
                             |
         +-------------------+-------------------+
         |                                       |
         v                                       v
+------------------+                    +------------------+
| WhatsApp İletişim|                    |  Google E-Tablo  |
|  (Şoför Mesajı)  |                    | (Sürücü Listesi) |
+------------------+                    +------------------+
```

### Bileşenler:
1. **Frontend (Yönetim Paneli):** React / Vite / Custom CSS. WhatsApp QR kodunu gösterir, şoför durumlarını ve canlı tabloyu listeler.
2. **Backend (Node.js Service):** `@whiskeysockets/baileys` ile WhatsApp oturumunu yönetir, Google Sheets API ile tabloyu okur ve günceller.
3. **Akıllı Zaman Ayıklayıcı (Time Parser):** Şoförlerin yazdığı *"16:30"*, *"17.00"*, *"saat 5 gibi"*, *"18 de"* gibi ifadelerden standart `HH:MM` formatını çıkarır.

---

## 3. Veri Yapısı (Google Sheet Mapping)

Ekteki Google Tablosu sütun haritası:
- **Sütun B (Sürücü):** Sürücü Adı Soyadı
- **Sütun C (Plaka):** Araç Plakası
- **Sütun D (İletişim):** Telefon Numarası
- **Sütun E (Giriş):** Giriş Saati (Eğer dolu veya `*` değilse araç zaten girmiş demektir)
- **Sütun F (Çıkış):** Çıkış Saati
- **Sütun J (NOT):** **[HEDEF SÜTUN]** Şoförün belirttiği Tahmini Geliş Saati (ETA) yazılacak alan.

---

## 4. Senaryo ve Kullanım Akışı

1. **WhatsApp Bağlantısı:** Depo yöneticisi web panelindeki QR kodu telefonuyla okutur ve WhatsApp bağlı hale gelir.
2. **Otomatik Taramalar:** Sistem belirli aralıklarla (ör. 10 dakikada bir) veya panelden "Şoförlere Mesaj Gönder" butonuna basılınca Google Tablo'yu okur.
3. **Hedef Şoför Filtresi:** `Giriş` sütununda saati olmayan ve `NOT` sütunu boş olan şoförler tespit edilir.
4. **Soru Mesajı:** Şoföre mesaj atılır:
   > *"Merhaba Sayın [Sürücü], [Plaka] plakalı araç ile depomuza tahmini varış saatiniz nedir?"*
5. **Cevap ve Güncelleme:** Şoför örneğin *"16:45"* yazdığında, bot cevabı algılar, tablodaki o şoförün **NOT** sütununa `16:45` yazar ve şoföre teşekkür mesajı gönderir.

---

## 5. Doğrulama ve Test Planı
- WhatsApp QR bağlantısının kopma/yeniden bağlanma durumları.
- Şoförün farklı formatlarda verdiği saat cevaplarının doğru ayrıştırılması.
- Google Sheets API yazma yetkisi ve canlı hücre güncellemesi.
