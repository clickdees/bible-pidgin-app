const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

// ====== CONFIG ======
const WIDTH = 784;
const HEIGHT = 1168;
const OUTPUT = path.join(__dirname, 'test-output.jpg');
const BG_PATH = path.join(__dirname, 'backgrounds/acacia.jpg');

// ====== DEBUG FONT PATHS ======
const fontPaths = {
  oswald: path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'),
  garamond: path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'),
  dejavu: path.join(__dirname, 'fonts/DejaVuSerif.ttf')
};

console.log('🔍 Checking fonts...');
Object.entries(fontPaths).forEach(([name, fontPath]) => {
  const exists = fs.existsSync(fontPath);
  console.log(`${name.padEnd(12)}: ${exists ? '✅' : '❌'} ${fontPath}`);
});

// ====== REGISTER FONTS WITH ABSOLUTE PATHS ======
if (fs.existsSync(fontPaths.oswald)) {
  registerFont(fontPaths.oswald, { family: 'Oswald', weight: '600' });
  console.log('✅ Registered Oswald');
}

if (fs.existsSync(fontPaths.garamond)) {
  registerFont(fontPaths.garamond, { family: 'EB Garamond', weight: '400' });
  console.log('✅ Registered EB Garamond');
}

if (fs.existsSync(fontPaths.dejavu)) {
  registerFont(fontPaths.dejavu, { family: 'DejaVuSerif', weight: '400' });
  console.log('✅ Registered DejaVuSerif');
}

// ====== MAIN FUNCTION ======
async function generate() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Load background
  const bg = await loadImage(BG_PATH);
  ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);

  // Dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Text settings
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const centerX = WIDTH / 2;

  // HEADER - Oswald
  ctx.font = '600 64px Oswald';
  console.log('Header font:', ctx.font);
  ctx.fillText('Philippians 4:6', centerX, 180);

  // BODY - DejaVuSerif (fallback to Garamond)
  ctx.font = 'bold 44px DejaVuSerif';
  const text = `No dey worry about anything,
just dey pray about everything.
Tell God wetin you need,
thank am for all e don do.`;

  wrapText(ctx, text, centerX, 320, WIDTH * 0.75, 60);

  // FOOTER TEST - EB Garamond
  ctx.font = '400 32px "EB Garamond"';
  ctx.fillText('Daily Pidgin Verse', centerX, HEIGHT - 100);

  // Save
  fs.writeFileSync(OUTPUT, canvas.toBuffer('image/jpeg', { quality: 0.95 }));
  console.log(`✅ Image saved: ${OUTPUT}`);
}

// ====== IMPROVED TEXT WRAPPER ======
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = '';
  let currentY = y;

  for (let word of words) {
    const testLine = line + word + ' ';
    const metrics = ctx.measureText(testLine);
    const width = metrics.width;

    if (width > maxWidth && line !== '') {
      ctx.fillText(line.trim(), x, currentY);
      line = word + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  
  ctx.fillText(line.trim(), x, currentY);
  console.log('Body font:', ctx.font);
}

// ====== RUN ======
generate().catch(err => {
  console.error('❌ Error:', err);
  console.error('Full error:', err.stack);
});
