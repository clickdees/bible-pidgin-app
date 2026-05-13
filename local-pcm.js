require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

// ==================== CONFIG ====================
const PCM_DIR = path.join(__dirname, 'pcm_html');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGE_OUTPUT_EN = path.join(__dirname, 'daily-verse-en.jpg');
const IMAGE_OUTPUT_PG = path.join(__dirname, 'daily-verse-pg.jpg');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER + '@c.us';
//choose if you want to send English version3
const SEND_ENGLISH_GRAPHIC = false;

registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'OswaldCustom' });
registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'GaramondCustom' });

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

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

// ==================== IMPROVED HELPERS ====================

function parseRef(ref) {
    if (!ref) return null;
    // Clean input (remove brackets, extra spaces)
    let clean = ref.toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, '').replace(/of/g, '');
    const match = clean.match(/^(\d?[a-z]+)(\d+):(\d+)(?:-(\d+))?$/);
    if (!match) return null;

    let bookName = match[1];
    const chapter = parseInt(match[2]);
    const startVerse = parseInt(match[3]);
    const endVerse = match[4] ? parseInt(match[4]) : startVerse;
    const bookCode = bookMap[bookName];
    if (!bookCode) return null;

    const pad = (bookCode === 'PSA') ? 3 : 2;
    const chapterStr = chapter.toString().padStart(pad, '0');
    return { bookCode, chapterStr, startVerse, endVerse, fullRef: ref };
}

async function getPCMVerse(ref) {
    const parsed = parseRef(ref);
    if (!parsed) return null;
    const { bookCode, chapterStr, startVerse, endVerse } = parsed;
    
    const filename = `${bookCode}${chapterStr}.htm`;
    const filePath = path.join(PCM_DIR, filename);

    console.log(`🔍 Searching local file: ${filename}`);

    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found in pcm_html: ${filename}`);
        return null;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(html);
    let fullText = "";

    // Iterate through all verse spans to find our range
    $('.verse').each((i, el) => {
        const vNum = parseInt($(el).text().replace(/[^\d]/g, ''));
        
        if (vNum >= startVerse && vNum <= endVerse) {
            let verseText = "";
            
            // 1. Get text nodes/siblings inside the SAME paragraph/div
            let curr = el.nextSibling;
            while (curr) {
                // Stop if we hit the next verse span
                if (curr.type === 'tag' && $(curr).hasClass('verse')) break;
                
                // Collect text from text nodes or child elements (like <i>)
                verseText += (curr.type === 'text') ? curr.data : $(curr).text();
                curr = curr.nextSibling;
            }

            // 2. If the verse continues into the NEXT paragraph (no next verse found yet)
            if (!curr) {
                let nextPara = $(el).parent().next();
                // Keep jumping to next paragraphs until we find one that contains a .verse span
                while (nextPara.length > 0 && nextPara.find('.verse').length === 0) {
                    verseText += " " + nextPara.text();
                    nextPara = nextPara.next();
                }
                // If the next paragraph HAS a verse span, grab the text BEFORE that span
                if (nextPara.length > 0 && nextPara.find('.verse').length > 0) {
                    nextPara.contents().each((_, node) => {
                        if (node.type === 'tag' && $(node).hasClass('verse')) return false; // break
                        verseText += (node.type === 'text') ? node.data : $(node).text();
                    });
                }
            }
            fullText += verseText + " ";
        }
    });

    const cleanedText = fullText.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanedText) {
        console.log(`✅ Found PCM Text: "${cleanedText.substring(0, 50)}..."`);
    } else {
        console.log(`⚠️  File opened, but could not extract text for verse ${startVerse}.`);
    }
    return cleanedText || null;
}

async function getEnglishVerse(ref) {
    try {
        const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=NLT`;
        const res = await axios.get(url);
        const $ = cheerio.load(res.data);
        let text = '';
        $('.passage-text p').each((_, el) => {
            $(el).find('.chapternum, .versenum').remove(); // Clean numbers
            text += $(el).text().trim() + ' ';
        });
        return text.trim().replace(/\s+/g, ' ') || 'Verse not found';
    } catch (e) { return 'Error fetching English verse'; }
}

async function getVersesFromLlama(theme, numDays) {
    const prompt = `Return ONLY a valid JSON array of ${numDays} Bible references for the theme "${theme}". Format: [{"day":1, "ref":"John 3:16"}]`;
    try {
        const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [{ role: "user", content: prompt }],
        }, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
        let raw = res.data.choices[0].message.content.trim();
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        return JSON.parse(raw.substring(start, end + 1)).slice(0, numDays);
    } catch (err) { throw new Error("Llama API failed."); }
}

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

async function createGraphic(data, isPidgin) {
    const backgrounds = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
    const bgPath = path.join(BACKGROUNDS_DIR, backgrounds[Math.floor(Math.random() * backgrounds.length)]);
    const img = await loadImage(bgPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    // const centerX = img.width / 2;
    const leftShift = 20; // Adjust this number based on how far left you want it
    const centerX = (img.width / 2) - leftShift;
    const text = isPidgin ? data.pidgin : data.english;
    const outputPath = isPidgin ? IMAGE_OUTPUT_PG : IMAGE_OUTPUT_EN;
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `70px OswaldCustom`;
    ctx.fillText(data.ref, centerX, 180);
    let currentFontSize = isPidgin ? 56 : 58;
    let lines = [];
    while (currentFontSize > 28) {
        ctx.font = `${currentFontSize}px GaramondCustom`;
        // lines = wrapTextToLines(ctx, text, img.width - 160);
        lines = wrapTextToLines(ctx, text, img.width - 170);
        if ((lines.length * (currentFontSize * 1.25)) + 400 < img.height) break;
        currentFontSize -= 2;
    }
    let startY = (img.height - (lines.length * currentFontSize * 1.25)) / 2 + 80;
    // Title is at 180. Title font is 70px. 
    // 180 + 70 + 40(gap) = 290
    // let startY = 320;
    for (let line of lines) {
        ctx.fillText(line, centerX, startY);
        startY += currentFontSize * 1.25;
    }
    ctx.font = `32px GaramondCustom`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(isPidgin ? "PCM Pidgin Bible" : "English (NLT)", centerX, img.height - 100);
    fs.writeFileSync(outputPath, canvas.toBuffer('image/jpeg'));
    return outputPath;
}

// ==================== MAIN LOOP ====================

async function startApp() {
    console.log('📱 Initializing WhatsApp...');
    
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: { headless: true, args: ['--no-sandbox'] }
    });

    client.on('qr', qr => {
        console.log('👉 Please scan this QR code:');
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (p, m) => console.log(`⚡ WhatsApp Loading: ${p}% - ${m}`));
    client.on('authenticated', () => console.log('✅ WhatsApp Authenticated!'));
    
    client.initialize();
    await new Promise(resolve => client.on('ready', resolve));
    console.log('🚀 WhatsApp Connection Established!');

    let running = true;
    while (running) {
        console.log('\n--- PCM Local Bible Graphics Tool ---');
        console.log('1. Generate from Theme (AI)');
        console.log('2. Lookup specific verse');
        console.log('3. Quit');
        
        const mode = await ask('Selection: ');

        if (mode === '3') {
            console.log('Goodbye!');
            running = false;
            break;
        }

        let todayData = null;

        try {
            if (mode === '2') {
                const refInput = await ask('Enter verse (e.g. John 3:16): ');
                const ref = refInput.trim();
                const english = await getEnglishVerse(ref);
                const pidgin = await getPCMVerse(ref);
                todayData = { ref, english, pidgin };
            } else if (mode === '1') {
                const theme = await ask('Enter Theme Name: ');
                const daysInput = await ask('How many days? (e.g. 1): ');
                const numDays = parseInt(daysInput) || 1;
                const versesList = await getVersesFromLlama(theme, numDays);
                const v = versesList[0];
                const english = await getEnglishVerse(v.ref);
                const pidgin = await getPCMVerse(v.ref);
                todayData = { ref: v.ref, english, pidgin };
            }

            if (todayData && todayData.pidgin) {
                console.log(`🎨 Creating images for ${todayData.ref}...`);
                if (SEND_ENGLISH_GRAPHIC) {
                    const enPath = await createGraphic(todayData, false);
                    await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(enPath), { caption: `📖 ${todayData.ref} (English)` });
                }
                const pgPath = await createGraphic(todayData, true);
                await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(pgPath), { caption: `📖 ${todayData.ref} (PCM Pidgin)` });
                console.log('✅ Graphics sent!');
            } else {
                console.log('❌ Error: Could not find that verse in your local Pidgin files.');
            }
        } catch (err) {
            console.error('❌ Error:', err.message);
        }
    }
    await client.destroy();
    rl.close();
    process.exit(0);
}

startApp().catch(err => console.error('Main Error:', err));