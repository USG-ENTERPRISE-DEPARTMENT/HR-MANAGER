// aiOcr — offline OCR for uploaded receipts/IDs using tesseract.js (pure JS, no native deps,
// CPU-bound). The raw text is then passed to the local model to extract structured fields so a
// Medical claim can be pre-filled. Both steps run fully offline.
const Tesseract = require('tesseract.js');
const aiClient  = require('./aiClient');

// Extract plain text from an image/PDF file path. (Tesseract handles common image formats;
// PDFs should be image-based or pre-rasterised — text-PDFs may yield little.)
async function ocrFile(filePath) {
  const { data } = await Tesseract.recognize(filePath, 'eng');
  return (data?.text || '').trim();
}

// Ask the local model to pull claim fields out of OCR text. Returns a best-effort object.
async function extractClaimFields(ocrText) {
  const text = String(ocrText || '').slice(0, 4000);
  if (!text) return { fields: {}, raw: '' };

  const messages = [
    {
      role: 'system',
      content:
        'You extract medical receipt fields from OCR text. Respond with ONLY a compact JSON object ' +
        'with keys: amount (number), date (YYYY-MM-DD), hospital (string), description (string). ' +
        'Use null for anything not found. Do not add commentary.',
    },
    { role: 'user', content: text },
  ];

  let content = '';
  try {
    const res = await aiClient.chat({ messages, temperature: 0 });
    content = res?.choices?.[0]?.message?.content || '';
  } catch (e) {
    return { fields: {}, raw: text, error: e.message };
  }

  // Pull the first JSON object out of the response (small models sometimes wrap it).
  let fields = {};
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) fields = JSON.parse(match[0]);
  } catch { /* leave fields empty on parse failure */ }

  return { fields, raw: text };
}

module.exports = { ocrFile, extractClaimFields };
