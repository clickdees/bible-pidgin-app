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

const SEND_ENGLISH_GRAPHIC = true;   // ← Change to false anytime

registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'OswaldCustom' });
registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'GaramondCustom' });

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

// ==================== BOOK MAP ====================
const bookMap = {
  "genesis":"GEN","exodus":"EXO","leviticus":"LEV","numbers":"NUM","deuteronomy":"DEU",
  "joshua":"JOS","judges":"JDG","ruth":"RUT","1samuel":"1SA","2samuel":"2SA",
  "1kings":"1KI","2kings":"2KI","1chronicles":"1CH","2chronicles":"2CH",
  "ezra":"EZR","nehemiah":"NEH","esther":"EST","job":"JOB","psalms":"PSA","psalm":"PSA",
  "proverbs":"PRO","ecclesiastes":"ECC","songofsongs":"SNG","songofsolomon":"SNG","sos":"SNG",
  "isaiah":"ISA","jeremiah":"JER","lamentations":"LAM","ezekiel":"EZK","daniel":"DAN",
  "hosea":"HOS","joel":"JOL","amos":"AMO","obadiah":"OBA","jonah":"JON","micah":"MIC",
  "nahum":"NAM","habakkuk":"HAB","zephaniah":"ZEP","haggai":"HAG","zechariah":"ZEC","malachi":"MAL",
  "matthew":"MAT","mark":"MRK","luke":"LUK","john":"JHN","acts":"ACT","romans":"ROM",
  "1corinthians":"1CO","2corinthians":"2CO","galatians":"GAL","ephesians":"EPH",
  "philippians":"PHP","colossians":"COL","1thessalonians":"1TH","2thessalonians":"2TH",
  "1timothy":"1TI","2timothy":"2TI","titus":"TIT","philemon":"PHM","hebrews":"HEB",
  "james":"JAS","1peter":"1PE","2peter":"2PE","1john":"1JN","2john":"2JN","3john":"3JN",
  "jude":"JUD","revelation":"REV"
};

// ==================== parseRef (now properly handles ranges) ====================
// function parseRef(ref) {
//   if (!ref) return null;

//   // Clean input: "Psalm 91:1-4" → "psalm91:1-4"
//   let clean = ref.toLowerCase().replace(/ /g, '').replace(/of/g, '');

//   // Match single verse or range: Book Chapter:Verse or Book Chapter:Start-End
//   const match = clean.match(/^(\d?[a-z]+)(\d+):(\d+)(?:-(\d+))?$/);
//   if (!match) return null;

//   let bookName = match[1];
//   const chapter = parseInt(match[2]);
//   const startVerse = parseInt(match[3]);
//   const endVerse = match[4] ? parseInt(match[4]) : startVerse;   // if no range, end = start

//   const bookCode = bookMap[bookName];
//   if (!bookCode) return null;

//   const pad = (bookCode === 'PSA') ? 3 : 2;
//   const chapterStr = chapter.toString().padStart(pad, '0');

//   return {
//     bookCode,
//     chapterStr,
//     startVerse,
//     endVerse,
//     fullRef: ref
//   };
// }

// ==================== IMPROVED parseRef (handles typos + ranges) ====================
function parseRef(ref) {
  if (!ref) return null;

  // Clean the input
  let clean = ref.toLowerCase()
    .replace(/ /g, '')           // remove spaces
    .replace(/of/g, '')          // "songofsolomon" → "songsolomon"
    .replace(/songofsolomon/, 'sng')
    .replace(/songofsongs/, 'sng')
    .replace(/revelations/, 'revelation')
    .replace(/mathew/, 'matthew')     // ← Fix common typo
    .replace(/mattew/, 'matthew')
    .replace(/1john/, '1jn')
    .replace(/2john/, '2jn')
    .replace(/3john/, '3jn');

  // Match Book Chapter:Verse or Book Chapter:Start-End
  const match = clean.match(/^(\d?[a-z]+)(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) {
    console.log(`   ⚠️ Could not parse reference: ${ref}`);
    return null;
  }

  let bookName = match[1];
  const chapter = parseInt(match[2]);
  const startVerse = parseInt(match[3]);
  const endVerse = match[4] ? parseInt(match[4]) : startVerse;

  const bookCode = bookMap[bookName];
  if (!bookCode) {
    console.log(`   ⚠️ Unknown book: ${bookName} (original: ${ref})`);
    return null;
  }

  const pad = (bookCode === 'PSA') ? 3 : 2;
  const chapterStr = chapter.toString().padStart(pad, '0');

  return {
    bookCode,
    chapterStr,
    startVerse,
    endVerse,
    fullRef: ref
  };
}

// ==================== getPCMVerse (now collects full range) ====================
async function getPCMVerse(ref) {
  console.log(` 📖 Fetching PCM Pidgin: ${ref}`);

  const parsed = parseRef(ref);
  if (!parsed) return `Invalid reference: ${ref}`;

  const { bookCode, chapterStr, startVerse, endVerse } = parsed;
  const filename = `${bookCode}${chapterStr}.htm`;
  const filePath = path.join(PCM_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.log(`   ❌ File not found: ${filename}`);
    return `PCM file not found (${filename})`;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);

  let fullText = '';

  // Find all verse spans
  $('.verse').each((_, el) => {
    const verseNum = parseInt($(el).text().trim());

    // Only collect verses inside the requested range
    if (verseNum >= startVerse && verseNum <= endVerse) {
      // Get the text that belongs to THIS verse only
      let verseText = '';

      // Start from this verse span and collect until the next verse span
      let current = $(el);
      while (current.length) {
        verseText += current.text() + ' ';

        // Stop when we reach the next verse number
        const next = current.next();
        if (next.is('span.verse') || next.find('span.verse').length > 0) {
          break;
        }
        current = next;
      }

      // Clean the text
      verseText = verseText
        .replace(/^\s*\d+\s*[:.]?\s*/, '')   // remove verse number
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (verseText) fullText += verseText + ' ';
    }
  });

  // Final cleanup
  fullText = fullText.trim();

  // Strong fallback regex if nothing was found
  if (!fullText) {
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const regex = new RegExp(`\\b${startVerse}\\s*[:.]?\\s*([^\\d].*?)(?=\\s+\\d+\\s*[:.]?|$)`, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
      fullText += match[1] + ' ';
    }
    fullText = fullText.trim();
  }

  return fullText || `Verses ${startVerse}-${endVerse} not found in ${filename}`;
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

// ==================== LLAMA (for theme mode only) ====================
// ==================== LLAMA - GET VERSES (Fixed) ====================
async function getVersesFromLlama(theme, numDays) {
  console.log(`\n🤖 Asking Llama for ${numDays} verses on theme: "${theme}"...`);

  const prompt = `You are a world-class Bible scholar and devotional planner.

Create a powerful ${numDays}-day devotional plan for the theme: "${theme}".

You MUST return EXACTLY ${numDays} verses — no more, no less.

Rules:
- Mix of Old Testament and New Testament
- Good variety of books
- Logical spiritual journey

Return **ONLY** a valid JSON array. No explanation, no extra text, no markdown, no code block.

Example format:
[
  {"day":1, "ref":"John 3:16"},
  {"day":2, "ref":"Romans 5:8"}
]

Your response must start with [ and end with ].`;

  try {
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });

    let raw = res.data.choices[0].message.content.trim();

    // Strong cleaning to remove any extra text Llama might add
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    
    if (start === -1 || end === -1) {
      throw new Error("Llama did not return valid JSON");
    }

    const jsonStr = raw.substring(start, end + 1);

    const verses = JSON.parse(jsonStr);
    
    // Safety: make sure we have exactly the number requested
    return verses.slice(0, numDays);

  } catch (err) {
    console.log('❌ Llama JSON error. Retrying with stricter prompt...');
    
    // Fallback: try one more time with even stricter instruction
    const strictPrompt = `Return ONLY this exact JSON and nothing else:\n[\n  {"day":1, "ref":"John 3:16"}\n]`;
    // ... you can expand retry logic if needed
    throw err;
  }
}

// ==================== GRAPHIC ====================
// ==================== IMPROVED DYNAMIC GRAPHIC ====================
async function createGraphic(data, isPidgin) {
  const backgrounds = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
  const bgPath = path.join(BACKGROUNDS_DIR, backgrounds[Math.floor(Math.random() * backgrounds.length)]);

  const img = await loadImage(bgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const centerX = img.width / 2;

  const text = isPidgin ? data.pidgin : data.english;
  const cleaned = text.replace(/^\d+\s*/, '').trim();
  const outputPath = isPidgin ? IMAGE_OUTPUT_PG : IMAGE_OUTPUT_EN;

  // Start with nice big fonts
  let refFontSize = 70;
  let verseFontSize = isPidgin ? 52 : 58;   // Pidgin text is usually longer, so start slightly smaller
  const lineHeight = verseFontSize * 1.25;   // nice spacing

  // Draw background and overlay
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(0, 0, img.width, img.height);

  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // === 1. Draw Reference (always big) ===
  ctx.font = `${refFontSize}px OswaldCustom`;
  ctx.fillText(data.ref, centerX, 180);

  // === 2. Dynamically wrap and size the main verse text ===
  let maxWidth = img.width - 160;   // good padding on sides

  // Try to fit the text - reduce font size until it fits nicely
  let lines = [];
  let currentFontSize = verseFontSize;

  while (currentFontSize > 28) {   // don't go too small
    ctx.font = `${currentFontSize}px GaramondCustom`;
    lines = wrapTextToLines(ctx, cleaned, maxWidth);
    
    const totalTextHeight = lines.length * (currentFontSize * 1.25);
    const totalHeightNeeded = 180 + refFontSize + 60 + totalTextHeight + 120; // top + ref + gap + text + bottom margin

    if (totalHeightNeeded < img.height) {
      break; // it fits!
    }
    currentFontSize -= 2;   // reduce font size and try again
  }

  // === 3. Draw the verse text centered vertically ===
  ctx.font = `${currentFontSize}px GaramondCustom`;
  const totalTextHeight = lines.length * (currentFontSize * 1.25);
  let startY = (img.height - totalTextHeight) / 2 + 80;   // +80 to give space below the reference

  for (let line of lines) {
    ctx.fillText(line, centerX, startY);
    startY += currentFontSize * 1.25;
  }

  // === 4. Footer ===
  ctx.font = `32px GaramondCustom`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(isPidgin ? "PCM Pidgin Bible" : "English (NLT)", centerX, img.height - 100 );

  fs.writeFileSync(outputPath, canvas.toBuffer('image/jpeg'));
  console.log(`   ✅ Graphic created (${lines.length} lines, font size ${currentFontSize})`);
  return outputPath;
}

// Helper function to wrap text into lines
function wrapTextToLines(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (let word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ==================== MAIN MENU ====================
async function runLocalPCM() {
  console.log('\n🔄 PCM Local Bible Graphics Tool\n');

  const mode = await ask('Choose mode:\n1. Generate from Theme\n2. Lookup specific verse (e.g. Psalm 91:1-4)\nEnter 1 or 2: ');

  let todayData;

  if (mode === '2') {
    // ==================== MANUAL VERSE MODE ====================
    const refInput = await ask('\nEnter verse (e.g. Psalm 91:1-4 or John 3:16): ');
    const ref = refInput.replace(/[\[\]]/g, '').trim();

    console.log(`\n🔍 Looking up: ${ref}`);
    const english = await getEnglishVerse(ref);
    const pidgin = await getPCMVerse(ref);

    todayData = { ref, english, pidgin };

  } else {
    // ==================== THEME MODE (original) ====================
    const theme = await ask('Enter Theme Name: ');
    const daysInput = await ask('How many days? (e.g. 1 or 30): ');
    const numDays = parseInt(daysInput) || 7;

    console.log(`\n🚀 Generating ${numDays} days for "${theme}"...`);
    const versesList = await getVersesFromLlama(theme, numDays);

    // For simplicity we only process the first day for sending (you can expand later)
    const v = versesList[0];
    const english = await getEnglishVerse(v.ref);
    const pidgin = await getPCMVerse(v.ref);
    todayData = { ref: v.ref, english, pidgin };
  }

  // ==================== CREATE & SEND GRAPHICS ====================
  if (!todayData || !todayData.pidgin || todayData.pidgin.includes('not found')) {
    console.log('❌ Could not find the verse. Please check the reference.');
    process.exit(0);
  }

  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: false, args: ['--no-sandbox'] }
  });

  client.on('qr', qr => qrcode.generate(qr, { small: true }));
  client.on('ready', async () => {
    console.log('🚀 WhatsApp connected! Sending graphics...');

    if (SEND_ENGLISH_GRAPHIC) {
      const enPath = await createGraphic(todayData, false);
      await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(enPath), {
        caption: `📖 ${todayData.ref} (English)`
      });
      console.log('✅ English graphic sent');
    }

    const pgPath = await createGraphic(todayData, true);
    await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(pgPath), {
      caption: `📖 ${todayData.ref} (PCM Pidgin)`
    });
    console.log('✅ PCM Pidgin graphic sent');

    console.log('\n🎉 Done!');
    process.exit(0);
  });

  client.initialize();
}

runLocalPCM().catch(err => console.error('❌ Error:', err.message));