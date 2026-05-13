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
const readline = require('readline');

// ==================== CONFIGURATION ====================
const CSV_PATH = path.join(__dirname, 'data/verses.csv');
const BACKGROUNDS_DIR = path.join(__dirname, 'backgrounds');
const IMAGE_OUTPUT_EN = path.join(__dirname, 'daily-verse-en.jpg');
const IMAGE_OUTPUT_PG = path.join(__dirname, 'daily-verse-pg.jpg');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER + '@c.us';

// ──────────────────────────────────────────────────────────────
// CHANGE THIS TO ANY BIBLEGATEWAY TRANSLATION YOU WANT
// Supported: MSG, NLT, NIV, KJV, ESV, AMP, TPT, NASB, etc.
// ──────────────────────────────────────────────────────────────
const BIBLE_TRANSLATION = 'NLT';   // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), { family: 'OswaldCustom' });
registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), { family: 'GaramondCustom' });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query) => new Promise(resolve => rl.question(query, resolve));

// ==================== HELPERS ====================
function cleanJSONResponse(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    return (start !== -1 && end !== -1) ? text.substring(start, end + 1) : text;
}

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
                console.log(`⏳ Rate limited... Waiting ${waitTime / 1000}s`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            throw e;
        }
    }
}

async function getBibleVerse(ref) {
    console.log(` 📖 Fetching ${BIBLE_TRANSLATION} verse: ${ref}`);
    const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=${BIBLE_TRANSLATION}`;
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    let text = '';
    $('.passage-text p').each((i, el) => { text += $(el).text().trim() + ' '; });
    return text.trim().replace('[a]', '').replace(/\s+/g, ' ') || 'Verse not found';
}

async function translateToPidgin(text) {
    //   const prompt = `Translate this Bible verse into clear Nigerian Pidgin (BBC Pidgin style). Use authentic BBC Pidgin spelling and grammar. Always try to translate every English word in the sentence into Pidgin.Return ONLY the translated text. No intro. Keep punctuation.\nVerse: "${text}"`;
//    const prompt = `You are a professional Bible translator for BBC Pidgin and the official Nigerian Pidgin Bible (Salem Egoh style).

//         You have translated hundreds of verses in the exact warm, natural, and powerful BBC Pidgin style that millions of Naija people love and relate to.

//         Translate the verse below into **clear, heartfelt, and spiritually powerful Nigerian Pidgin** exactly as it would be read on BBC Pidgin or in the Pidgin Bible.

//         Rules you MUST follow:
//         - Use authentic BBC Pidgin spelling and grammar (na, dey, wey, im, dia, bodi, una, wetin etc.)
//         - Keep the full meaning, emotion, reverence, and power of the original verse
//         - Make it sound like casual pidgin or broken english
//         - NEVER add any explanation, intro, quote marks, or extra words

//         Return **ONLY** the Pidgin translation. Nothing else.

//         Verse: "${text}"`;
    // const prompt = `As a BBC Pidgin Bible translator (Salem Egoh style), translate the verse below into natural, powerful Nigerian Pidgin.      Use authentic Pidgin grammar (e.g., na, dey, wey, im).     Preserve the original's full meaning, emotion, and power.     Return only the raw Pidgin translation.  Verse: "${text}"`
    const prompt = `Translate this Bible verse into clear Nigerian Pidgin (BBC Pidgin style). Use authentic BBC Pidgin spelling and grammar. Bible terms like "peace", "christ", "mercy" etc do not need translation. Always try to translate every English word in the sentence into Pidgin. Always use "Baba GOD" instead of "Lord". Return ONLY the translated text. Keep punctuation.\nVerse: "${text}"`;  
    console.log(` 🌍 Translating to Naija Pidgin...`);
    const raw = await callLlama(prompt);
    return raw.replace(/"/g, '').trim(); 
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

// ==================== CREATE GRAPHIC ====================
async function createGraphic(data, bgPath, isPidgin) {
    const img = await loadImage(bgPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    const centerX = img.width / 2;
    const padding = 80;
    const refFontSize = 70;
    const verseFontSize = 58;
    const verseLineHeight = 75;
    const spaceBetween = 50;

    const rawText = isPidgin ? data.pidgin : data.english;
    const cleanedText = rawText.replace(/^\d+\s*/, '').trim();
    const outputPath = isPidgin ? IMAGE_OUTPUT_PG : IMAGE_OUTPUT_EN;

    ctx.font = `${verseFontSize}px GaramondCustom`;
    const getWrappedHeight = (text, maxWidth) => {
        const words = text.split(' ');
        let line = '', count = 1;
        for (const w of words) {
            if (ctx.measureText(line + w + ' ').width > maxWidth) { line = w + ' '; count++; }
            else line += w + ' ';
        }
        return count * verseLineHeight;
    };

    const totalH = refFontSize + spaceBetween + getWrappedHeight(cleanedText, img.width - (padding * 2));
    let currentY = (canvas.height - totalH) / 2;

    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.font = `${refFontSize}px OswaldCustom`;
    ctx.fillText(data.ref, centerX, currentY);
    currentY += refFontSize + spaceBetween;

    ctx.font = `${verseFontSize}px GaramondCustom`;
    wrapText(ctx, cleanedText, centerX, currentY, img.width - (padding * 2), verseLineHeight);

    ctx.font = `30px GaramondCustom`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(isPidgin ? `Daily Pidgin Verse (${BIBLE_TRANSLATION})` : `Translation: ${BIBLE_TRANSLATION}`, centerX, img.height - 150);

    fs.writeFileSync(outputPath, canvas.toBuffer('image/jpeg'));
    return outputPath;
}

// ==================== MAIN LOOP ====================
async function startApp() {
    console.log('\n🔄 Bible Graphics App Started...');
    const client = new Client({ authStrategy: new LocalAuth(), puppeteer: { headless: true, args: ['--no-sandbox'] } });
    client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
    client.on('ready', () => console.log('🚀 WhatsApp Connected!'));
    client.initialize();

    while (true) {
        console.log('\n--- MAIN MENU ---');
        console.log('1. Manual Verse (Send specific verse now)');
        console.log('2. New Theme (Generate schedule for X days)');
        console.log('3. Today (Send scheduled verse from CSV)');
        console.log('4. Exit');

        const choice = await ask('\nSelect option (1-4): ');

        if (choice === '4' || choice.toLowerCase() === 'exit') break;

        let todayData = null;
        const todayStr = new Date().toLocaleDateString('en-CA');

        switch (choice) {
            case '1':
                const refInput = await ask('Enter verse in format [Book Chapter:Verse]: ');
                const ref = refInput.replace(/[\[\]]/g, '').trim();
                const englishText = await getBibleVerse(ref);
                const pidginText = await translateToPidgin(englishText);
                todayData = { ref, english: englishText, pidgin: pidginText };
                break;

            case '2':
                const theme = await ask('Enter Theme Name (e.g. Love): ');
                const days = await ask('How many days of content do you need? (e.g. 30): ');
                const numDays = parseInt(days) || 7;
                
                console.log(`🚀 Generating exactly ${numDays} days for "${theme}"...`);

                // ──────────────────────────────────────────────────────────────
                // BEST PROMPT — forces Llama to respect the exact number
                // ──────────────────────────────────────────────────────────────
                const prompt = `You are a world-class Bible scholar and devotional planner.

                    Create a powerful ${numDays}-day devotional plan for the theme "${theme}".

                    Rules:
                    - Return EXACTLY ${numDays} verses (no more, no less)
                    - One verse per day
                    - Good mix of Old Testament and New Testament
                    - Maximum variety of books (never repeat the same book more than 2–3 times)
                    - Logical spiritual journey (foundation → growth → challenge → victory)
                    - Use only real, correctly formatted references (e.g. "John 3:16", "Psalm 23:1")

                    Return **ONLY** a valid JSON array. No explanation, no extra text, no reasons.

                    [
                    {"day":1, "ref":"John 3:16"},
                    {"day":2, "ref":"Psalm 23:1"},
                    ...
                    {"day":${numDays}, "ref":"Matthew 6:33"}
                    ]`;

                const raw = await callLlama(prompt);
                const verses = JSON.parse(cleanJSONResponse(raw));

                // Safety: never generate more than requested
                const finalVerses = verses.slice(0, numDays);

                const records = [];
                for (let i = 0; i < finalVerses.length; i++) {
                    const v = finalVerses[i];
                    console.log(` 📖 Fetching ${BIBLE_TRANSLATION} verse: ${v.ref}`);
                    const eng = await getBibleVerse(v.ref);   // use your current function name
                    const p = await translateToPidgin(eng);
                    
                    const d = new Date(); 
                    d.setDate(d.getDate() + i);
                    
                    records.push({ 
                        date: d.toLocaleDateString('en-CA'), 
                        ref: v.ref, 
                        english: eng, 
                        pidgin: p 
                    });
                    console.log(` 💾 Saved Day ${i + 1}/${numDays}`);
                }

                const csvWriter = createObjectCsvWriter({
                    path: CSV_PATH,
                    header: [
                        {id:'date', title:'date'}, 
                        {id:'ref', title:'ref'}, 
                        {id:'english', title:'english'}, 
                        {id:'pidgin', title:'pidgin'}
                    ]
                });
                await csvWriter.writeRecords(records);
                console.log(`✅ CSV Schedule Updated with exactly ${numDays} days!`);
                todayData = records[0]; // send the first one immediately
                break;

            case '3':
                if (!fs.existsSync(CSV_PATH)) {
                    console.log('❌ No CSV found. Use Option 2 first.');
                    continue;
                }
                const rows = [];
                const stream = fs.createReadStream(CSV_PATH).pipe(csvParser());
                for await (const row of stream) {
                    const norm = {}; 
                    Object.keys(row).forEach(k => norm[k.toLowerCase()] = row[k]);
                    rows.push(norm);
                }
                todayData = rows.find(r => r.date === todayStr);
                if (!todayData) console.log('❌ No verse scheduled for today in CSV.');
                break;

            default:
                console.log('Invalid selection.');
                continue;
        }

        if (todayData) {
            if (!client.info) await new Promise(r => client.once('ready', r));
            const backgrounds = fs.readdirSync(BACKGROUNDS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
            // console.log('background: ', backgrounds.length);
            const bgPath = path.join(BACKGROUNDS_DIR, backgrounds[Math.floor(Math.random() * backgrounds.length)]);

            const en = await createGraphic(todayData, bgPath, false);
            const pg = await createGraphic(todayData, bgPath, true);

            await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(en), { caption: `📖 ${todayData.ref} (${BIBLE_TRANSLATION})` });
            await client.sendMessage(WHATSAPP_NUMBER, MessageMedia.fromFilePath(pg), { caption: `📖 ${todayData.ref} (Pidgin)` });
            console.log('✅ Sent to WhatsApp!');
        }
    }
    console.log('Goodbye! 👋');
    process.exit(0);
}

startApp().catch(err => console.error('❌ Error:', err));