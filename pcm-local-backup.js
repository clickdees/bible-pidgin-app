require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const { createObjectCsvWriter } = require('csv-writer');

// ==================== CONFIG ====================
const PCM_DIR = path.join(__dirname, 'pcm_html');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds');
const DATA_DIR = path.join(__dirname, 'data');
const CSV_PATH = path.join(DATA_DIR, 'pcm-schedule.csv');
const IMAGE_OUTPUT_EN = path.join(__dirname, 'daily-verse-en.jpg');
const IMAGE_OUTPUT_PG = path.join(__dirname, 'daily-verse-pg.jpg');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER + '@c.us';

const SEND_ENGLISH_GRAPHIC = true;   // ← Change to false to disable English graphic

registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'OswaldCustom' });
registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'GaramondCustom' });

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

// ==================== IMPROVED BOOK MAP ====================
const bookMap = {
  "genesis": "GEN", "exodus": "EXO", "leviticus": "LEV", "numbers": "NUM", "deuteronomy": "DEU",
  "joshua": "JOS", "judges": "JDG", "ruth": "RUT", "1samuel": "1SA", "2samuel": "2SA",
  "1kings": "1KI", "2kings": "2KI", "1chronicles": "1CH", "2chronicles": "2CH",
  "ezra": "EZR", "nehemiah": "NEH", "esther": "EST", "job": "JOB", "psalms": "PSA", "psalm": "PSA",
  "proverbs": "PRO", "ecclesiastes": "ECC", "songofsongs": "SNG", "songofsolomon": "SNG", "sos": "SNG",
  "isaiah": "ISA", "jeremiah": "JER", "lamentations": "LAM", "ezekiel": "EZK", "daniel": "DAN",
  "hosea": "HOS", "joel": "JOL", "amos": "AMO", "obadiah": "OBA", "jonah": "JON", "micah": "MIC",
  "nahum": "NAM", "habakkuk": "HAB", "zephaniah": "ZEP", "haggai": "HAG", "zechariah": "ZEC", "malachi": "MAL",
  "matthew": "MAT", "mark": "MRK", "luke": "LUK", "john": "JHN", "acts": "ACT", "romans": "ROM",
  "1corinthians": "1CO", "2corinthians": "2CO", "galatians": "GAL", "ephesians": "EPH",
  "philippians": "PHP", "colossians": "COL", "1thessalonians": "1TH", "2thessalonians": "2TH",
  "1timothy": "1TI", "2timothy": "2TI", "titus": "TIT", "philemon": "PHM", "hebrews": "HEB",
  "james": "JAS", "1peter": "1PE", "2peter": "2PE", "1john": "1JN", "2john": "2JN", "3john": "3JN",
  "jude": "JUD", "revelation": "REV",
  // Short forms
  "1jn": "1JN", "2jn": "2JN", "3jn": "3JN", "1co": "1CO", "2co": "2CO", "1th": "1TH", "2th": "2TH",
  "1ti": "1TI", "2ti": "2TI", "1pe": "1PE", "2pe": "2PE", "1sa": "1SA", "2sa": "2SA",
  "1ki": "1KI", "2ki": "2KI", "1ch": "1CH", "2ch": "2CH"
};

function parseRef(ref) {
  // Clean and normalize reference
  let clean = ref.toLowerCase().replace(/ /g, '').replace(/of/g, '');
  const match = clean.match(/^(\d?[a-z]+)(\d+):(\d+)$/);
  if (!match) return null;

  const bookName = match[1];
  const chapter = parseInt(match[2]);
  const verse = parseInt(match[3]);

  const bookCode = bookMap[bookName];
  if (!bookCode) return null;

  const pad = (bookCode === 'PSA') ? 3 : 2;
  const chapterStr = chapter.toString().padStart(pad, '0');

  return { bookCode, chapterStr, verse };
}

async function getPCMVerse(ref) {
  console.log(` 📖 Fetching PCM Pidgin: ${ref}`);
  const parsed = parseRef(ref);
  if (!parsed) return 'Invalid reference';

  const { bookCode, chapterStr, verse } = parsed;
  const filename = `${bookCode}${chapterStr}.htm`;
  const filePath = path.join(PCM_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️ File not found: ${filename}`);
    return 'PCM file not found';
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);

  let text = '';

  // Stronger extraction - look for verse number
  $('sup, .verse, span, b, strong').each((_, el) => {
    if ($(el).text().trim() === verse.toString() || $(el).text().trim() === `${verse}`) {
      let nextText = $(el).nextAll().first().text() || $(el).parent().text();
      text = nextText.replace(/^\s*\d+\s*/, '').trim();
      return false;
    }
  });

  // Fallback: regex search in whole body
  if (!text) {
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const regex = new RegExp(`\\b${verse}\\s+([^\\d].*?)(?=\\s+\\d+\\s+|$)`, 'i');
    const match = bodyText.match(regex);
    if (match) text = match[1].trim();
  }

  return text || 'Verse not found in PCM';
}

// ==================== ENGLISH VERSE ====================
async function getEnglishVerse(ref) {
  console.log(` 📖 Fetching English: ${ref}`);
  const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=NLT`;
  const res = await axios.get(url);
  const $ = cheerio.load(res.data);
  let text = '';
  $('.passage-text p').each((_, el) => text += $(el).text().trim() + ' ');
  return text.trim().replace(/\s+/g, ' ') || 'Verse not found';
}

// ==================== LLAMA (strict number of days) ====================
async function getVersesFromLlama(theme, numDays) {
  const prompt = `You are a world-class Bible scholar and devotional planner.

Create a powerful ${numDays}-day devotional plan for the theme "${theme}".

You MUST return EXACTLY ${numDays} verses — no more, no less.

Rules:
- Good mix of Old and New Testament
- Maximum variety of books
- Logical spiritual journey

Return ONLY a valid JSON array in this exact format:

[
  {"day":1, "ref":"John 3:16"},
  {"day":2, "ref":"Psalm 23:1"},
  ...
  {"day":${numDays}, "ref":"Matthew 6:33"}
]`;

  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: "meta-llama/llama-3.3-70b-instruct",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  }, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
  });

  const raw = res.data.choices[0].message.content.trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const jsonStr = raw.substring(start, end + 1);
  let verses = JSON.parse(jsonStr);

  // Extra safety: never exceed requested days
  return verses.slice(0, numDays);
}

// ==================== GRAPHIC (unchanged) ====================
async function createGraphic(data, isPidgin) {
  const backgrounds = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
  const bgPath = path.join(BACKGROUNDS_DIR, backgrounds[Math.floor(Math.random() * backgrounds.length)]);

  const img = await loadImage(bgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const centerX = img.width / 2;
  const padding = 80;

  const text = isPidgin ? data.pidgin : data.english;
  const cleaned = text.replace(/^\d+\s*/, '').trim();
  const outputPath = isPidgin ? IMAGE_OUTPUT_PG : IMAGE_OUTPUT_EN;

  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.font = `70px OswaldCustom`;
  ctx.fillText(data.ref, centerX, (img.height - 300) / 2);

  ctx.font = `48px GaramondCustom`;
  const words = cleaned.split(' ');
  let line = '', y = (img.height - 300) / 2 + 120;
  for (let w of words) {
    const test = line + w + ' ';
    if (ctx.measureText(test).width > img.width - padding * 2) {
      ctx.fillText(line.trim(), centerX, y);
      line = w + ' ';
      y += 75;
    } else line = test;
  }
  ctx.fillText(line.trim(), centerX, y);

  ctx.font = `30px GaramondCustom`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(isPidgin ? "PCM Pidgin Bible" : "English (NLT)", centerX, img.height - 100);

  fs.writeFileSync(outputPath, canvas.toBuffer('image/jpeg'));
  return outputPath;
}

// ==================== MAIN ====================
async function runLocalPCM() {
  console.log('\n🔄 PCM Local Bible Graphics Tool\n');

  const theme = await ask('Enter Theme Name (e.g. Love): ');
  const daysInput = await ask('How many days? (e.g. 1 or 30): ');
  const numDays = parseInt(daysInput) || 7;

  console.log(`\n🚀 Generating exactly ${numDays} days for "${theme}" using local PCM Bible...`);

  const versesList = await getVersesFromLlama(theme, numDays);

  const records = [];
  for (let i = 0; i < numDays && i < versesList.length; i++) {
    const v = versesList[i];
    console.log(`\n📅 Day ${i+1}/${numDays} → ${v.ref}`);

    const english = await getEnglishVerse(v.ref);
    const pidgin = await getPCMVerse(v.ref);

    records.push({
      date: new Date(Date.now() + i * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA'),
      ref: v.ref,
      english: english,
      pidgin: pidgin
    });

    console.log(`   ✅ Saved`);
  }

  // Save to its own CSV
  const csvWriter = createObjectCsvWriter({
    path: CSV_PATH,
    header: [
      {id: 'date', title: 'date'},
      {id: 'ref', title: 'ref'},
      {id: 'english', title: 'english'},
      {id: 'pidgin', title: 'pidgin'}
    ]
  });
  await csvWriter.writeRecords(records);
  console.log(`✅ Schedule saved to data/pcm-schedule.csv`);

  // Send first day's graphics
  const todayData = records[0];

  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox'] }
  });

  client.on('qr', qr => qrcode.generate(qr, { small: true }));
  client.on('ready', async () => {
    console.log('🚀 WhatsApp connected! Sending...');

    if (SEND_ENGLISH_GRAPHIC) {
      const enPath = await createGraphic(todayData, false);
      await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(enPath), {
        caption: `📖 ${todayData.ref} (English)`
      });
      console.log('✅ English graphic sent');
      console.log('   File exists? ${fs.existsSync(enPath)}');
    }

    const pgPath = await createGraphic(todayData, true);
    
    console.log(`   📤 Sending PCM file: ${pgPath}`);
    console.log(`   File exists? ${fs.existsSync(pgPath)}`);

    try {
      await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(pgPath), {
        caption: `📖 ${todayData.ref} (PCM Pidgin)`
      });
      console.log('✅ PCM Pidgin graphic sent successfully');
    } catch (err) {
      console.log('❌ Failed to send PCM graphic:', err.message);
    }

    console.log('\n🎉 All done!');
    process.exit(0);
  });

  client.initialize();
}

runLocalPCM().catch(err => console.error('❌ Error:', err.message));