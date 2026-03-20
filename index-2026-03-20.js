require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { createObjectCsvWriter } = require('csv-writer');
const csvParser = require('csv-parser');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ==================== CONFIGURATION ====================
const CSV_PATH = path.join(__dirname, 'data/verses.csv');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds');
const IMAGE_OUTPUT = path.join(__dirname, 'daily-verse.jpg');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER + '@c.us';

// --- 1. Load your multiple fonts ---
// Register the custom fonts. This will throw an error if a path is wrong.
// register fonts (put this at top of file, before any createCanvas calls)
// registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'Oswald', weight: '600' });
// registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'EBGaramond' }); // <-- Space removed

// registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'EBGaramond', weight: '400' });
registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'OswaldCustom' });
registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'GaramondCustom' });


// ==================== HELPERS (Unchanged) ====================
async function callLlama(prompt, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: "meta-llama/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }, {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
      });
      return res.data.choices[0].message.content.trim();
    } catch (e) {
      if (e.response?.status === 429) {
        const waitTime = Math.pow(2, attempt) * 3000;
        console.log(`⏳ Rate limited... Waiting ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw e;
    }
  }
}

async function getNLTVerse(ref) {
  console.log(` 📖 Fetching NLT verse: ${ref}`);
  const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=NLT`;
  const res = await axios.get(url);
  const $ = cheerio.load(res.data);
  let text = '';
  $('.passage-text p').each((i, el) => { text += $(el).text().trim() + ' '; });
  return text.trim().replace(/\s+/g, ' ') || 'Verse not found';
}

async function translateToPidgin(text) {
  // const prompt = `Translate this Bible verse to natural Nigerian Pidgin English. Keep the meaning exactly the same but make it sound like how we dey talk for Naija. Return ONLY the translated verse text and nothing else. Verse: "${text}"`;
  const prompt = `Translate this Bible verse into clear Nigerian Pidgin (BBC Pidgin style).

Rules:
- Use clean, standard Nigerian Pidgin (like BBC Pidgin).
- Keep grammar consistent and easy to read (not broken or slangy).
- Use common Pidgin words like "na", "dey", "go", "don", "fit".
- Keep the meaning exactly the same.
- Maintain a respectful, Bible-appropriate tone.
- Do not add explanations.

Example:
English: The Lord is my shepherd; I shall not want.
Pidgin: Di Lord na my shepherd; I no go lack anything.

Return ONLY the translated verse.

Verse: "${text}"`;
  console.log(` 🌍 Translating to Naija Pidgin...`);
  const raw = await callLlama(prompt);
  return extractPidginVerse(raw);
}

function extractPidginVerse(text) {
  const match = text.match(/"(\d+[^"]*)"/);
  if (match) return match[1].trim();
  const alt = text.match(/\d+[\s\S]*/);
  return alt? alt[0].split('\n')[0].trim() : text.trim();
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = context.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      context.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  context.fillText(line.trim(), x, currentY);
}

// ==================== GENERATE DAYS (Unchanged) ====================
async function generateMonth(theme, numDays) {
  console.log(`🚀 Generating ${numDays} days for theme: "${theme}"`);
  const prompt = `You are a Bible expert. For the monthly theme "${theme}", give me exactly ${numDays} Bible verses (one per day) related to the theme.
Return ONLY valid JSON array like this:
[{"day":1, "ref":"John 3:16", "reason":"God's love"},... up to day ${numDays}]
Make sure refs are standard (e.g. Psalm 23:1, Matthew 6:33).`;

  const jsonStr = await callLlama(prompt);
  const verses = JSON.parse(jsonStr);
  console.log(`✅ Received ${verses.length} verses!`);

  const csvWriter = createObjectCsvWriter({
    path: CSV_PATH,
    header: [{id: 'date', title: 'date'}, {id: 'ref', title: 'ref'}, {id: 'nlt', title: 'nlt'}, {id: 'pidgin', title: 'pidgin'}]
  });

  const records = [];
  const startDate = new Date();
  startDate.setHours(0,0,0,0);

  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    console.log(`\n📅 Day ${v.day}/${numDays} → ${v.ref}`);
    const nlt = await getNLTVerse(v.ref);
    console.log(` ✅ NLT loaded`);
    const pidgin = await translateToPidgin(nlt);
    console.log(` ✅ Pidgin done`);
    await new Promise(r => setTimeout(r, 800));
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + v.day - 1);
    records.push({ date: dayDate.toLocaleDateString('en-CA'), ref: v.ref, nlt, pidgin });
    console.log(` 💾 Saved (${Math.round(((i+1)/numDays)*100)}% done)`);
  }

  await csvWriter.writeRecords(records);
  console.log(`🎉 All ${numDays} days saved!`);
  return records;
}

// ==================== CREATE GRAPHIC ====================
async function createGraphic(data) {
  console.log(`🎨 Creating graphic...`);
  const backgrounds = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
  const bgPath = path.join(BACKGROUNDS_DIR, backgrounds[Math.floor(Math.random() * backgrounds.length)]);

  const img = await loadImage(bgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const centerX = img.width / 2;
  const padding = 80; // Increased padding slightly for a cleaner look

  // --- Adjust font sizes for the new pairing ---
  const refFontSize = 70; // Oswald is condensed, so we can make it larger
  const verseFontSize = 58; // EB Garamond is very readable
  const verseLineHeight = 75;
  const spaceBetween = 50;

  const cleanedPidgin = data.pidgin.replace(/^\d+\s*/, '').trim();

  const getWrappedTextHeight = (text, maxWidth) => {
    const words = text.split(' ');
    let line = '';
    let lineCount = 1;
    for (const word of words) {
      const testLine = line + word + ' ';
      if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
        line = word + ' ';
        lineCount++;
      } else {
        line = testLine;
      }
    }
    return lineCount * verseLineHeight;
  };

  // --- Calculate Heights with the correct new fonts ---
  ctx.font = `${refFontSize}px OswaldCustom`; 
  const refHeight = refFontSize;
  ctx.font = `${verseFontSize}px GaramondCustom`; 
  const verseHeight = getWrappedTextHeight(cleanedPidgin, img.width - (padding * 2));
  const totalContentHeight = refHeight + spaceBetween + verseHeight;

  let currentY = (canvas.height - totalContentHeight) / 2;

  // --- Draw ---
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, img.width, img.height);

  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Draw Reference using Oswald
  ctx.font = `${refFontSize}px OswaldCustom`;
  ctx.fillText(data.ref, centerX, currentY);
  currentY += refHeight + spaceBetween;

  // Draw Verse using EB Garamond
  ctx.font = `${verseFontSize}px GaramondCustom`;
  wrapText(ctx, cleanedPidgin, centerX, currentY, img.width - (padding * 2), verseLineHeight);

  fs.writeFileSync(IMAGE_OUTPUT, canvas.toBuffer('image/jpeg'));
  console.log(`✅ Graphic ready!`);
  return IMAGE_OUTPUT;
}

// ==================== WHATSAPP (Unchanged) ====================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => qrcode.generate(qr, {small: true}));
client.on('ready', () => console.log('🚀 WhatsApp connected!'));
client.initialize();

// ==================== MAIN (Unchanged) ====================
async function runDaily() {
  console.log('\n🔄 Starting daily verse app...');
  const today = new Date().toLocaleDateString('en-CA');
  let records = [];

  if (fs.existsSync(CSV_PATH)) {
    const stream = fs.createReadStream(CSV_PATH).pipe(csvParser());
    for await (const row of stream) {
      const normalized = {};
      for (const key of Object.keys(row)) {
        normalized[key.toLowerCase()] = row[key];
      }
      records.push(normalized);
    }
  }

  let todayData = records.find(r => r.date === today);

  if (!todayData) {
    const theme = await new Promise(r => {
      console.log('\n✍️ Enter theme (e.g. Love):');
      process.stdin.once('data', d => r(d.toString().trim()));
    });
    const daysInput = await new Promise(r => {
      console.log('📅 How many days? (type 1 for testing):');
      process.stdin.once('data', d => r(d.toString().trim()));
    });
    const numDays = parseInt(daysInput) || 30;
    records = await generateMonth(theme, numDays);
    todayData = records.find(r => r.date === today);
  }

  if (!todayData) {
    console.error('❌ No verse found for today:', today);
    throw new Error(`No verse found for today (${today}).`);
  }

  const payload = {
    ref: todayData.ref,
    nlt: todayData.nlt,
    pidgin: todayData.pidgin
  };

  if (!payload.ref ||!payload.pidgin) {
    console.error('❌ Incomplete data for today:', payload);
    throw new Error('Incomplete verse data for today.');
  }

  if (!client.info) await new Promise(r => client.once('ready', r));

  const imagePath = await createGraphic(payload);
  console.log('📤 Sending to WhatsApp...');
  const media = MessageMedia.fromFilePath(imagePath);
  await client.sendMessage(WHATSAPP_NUMBER, media, { caption: `📖 ${payload.ref}\nVerse of the day 🙏🏿` });

  console.log('\n🎉 DONE! Image sent.');
}

runDaily().catch(err => console.error('❌ Error:', err.message, err.stack));