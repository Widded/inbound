function parseTurkishTime(text) {
  if (!text) return null;
  const str = text.trim().toLowerCase();

  // 1. Textual half-hours (e.g. "5 buçuk", "5 bucuk", "dört buçuk", "beş buçuk", "4 buçuk", "saat 5 buçuk")
  const wordToNum = {
    'bir': 1, 'iki': 2, 'üç': 3, 'uc': 3, 'dört': 4, 'dort': 4,
    'beş': 5, 'bes': 5, 'altı': 6, 'alti': 6, 'yedi': 7, 'sekiz': 8,
    'dokuz': 9, 'on': 10, 'on bir': 11, 'on iki': 12, 'on üç': 13,
    'on dört': 14, 'on beş': 15, 'on altı': 16, 'on yedi': 17, 'on sekiz': 18,
    'on dokuz': 19, 'yirmi': 20, 'yirmi bir': 21, 'yirmi iki': 22, 'yirmi üç': 23
  };

  const regexBucuk = /(?:saat\s*)?([0-2]?[0-9]|bir|iki|üç|uc|dört|dort|beş|bes|altı|alti|yedi|sekiz|dokuz|on|on\s*bir|on\s*iki|on\s*üç|on\s*dört|on\s*beş|on\s*altı|on\s*yedi|on\s*sekiz|on\s*dokuz|yirmi|yirmi\s*bir|yirmi\s*iki|yirmi\s*üç)\s*bu[çc]uk/i;
  const matchBucuk = str.match(regexBucuk);
  if (matchBucuk) {
    let rawHour = matchBucuk[1].trim();
    let hourNum = isNaN(parseInt(rawHour, 10)) ? wordToNum[rawHour] : parseInt(rawHour, 10);
    if (hourNum !== undefined && !isNaN(hourNum)) {
      if (hourNum >= 1 && hourNum <= 11) hourNum += 12;
      if (hourNum >= 0 && hourNum <= 23) {
        return `${String(hourNum).padStart(2, '0')}:30`;
      }
    }
  }

  // 2. Match HH:MM, HH.MM, or HH MM (e.g. 16:30, 16.30, 16 30, 5:30, 5.30, 5 30)
  const regexColonDotSpace = /\b([0-2]?[0-9])[:.\s]([0-5][0-9])\b/;
  const matchColonDotSpace = str.match(regexColonDotSpace);
  if (matchColonDotSpace) {
    let hourNum = parseInt(matchColonDotSpace[1], 10);
    const minutes = matchColonDotSpace[2];
    
    // Automatically map 1-11 in 12h format to afternoon/evening (13:00 - 23:00)
    if (hourNum >= 1 && hourNum <= 11) {
      hourNum += 12;
    }
    
    if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
      return `${String(hourNum).padStart(2, '0')}:${minutes}`;
    }
  }

  // 3. Match 4-digit military time without separator (e.g. 1630, 1700, 1730)
  const regexFourDigit = /\b([0-2][0-9])([0-5][0-9])\b/;
  const matchFourDigit = str.match(regexFourDigit);
  if (matchFourDigit) {
    const hourNum = parseInt(matchFourDigit[1], 10);
    const minutes = matchFourDigit[2];
    if (hourNum >= 12 && hourNum <= 23) {
      return `${String(hourNum).padStart(2, '0')}:${minutes}`;
    }
  }

  // 4. Match single hour (e.g. "5", "saat 5 gibi", "saat 17", "18 de", "8 de", "5'te", "17 civarı", "16:00")
  const regexSaatSingle = /(?:saat\s*)?([0-2]?[0-9])(?:\s*(?:de|da|te|ta|'de|'da|'te|'ta|gibi|civarı|civarında|e\s*doğru|a\s*doğru))?(?:\s|$|[.,!?])/;
  const matchSaat = str.match(regexSaatSingle);
  if (matchSaat) {
    let hourNum = parseInt(matchSaat[1], 10);
    if (!isNaN(hourNum) && hourNum >= 1 && hourNum <= 24) {
      // Automatically map 1-11 in 12h format to afternoon/evening (13:00 - 23:00)
      if (hourNum >= 1 && hourNum <= 11) {
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
