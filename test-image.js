const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

// ====== CONFIG ======
const WIDTH = 784;
const HEIGHT = 1168;

const OUTPUT = path.join(__dirname, 'test-output.jpg');
const BG_PATH = path.join(__dirname, 'backgrounds/acacia.jpg'); // <-- add any image here

// ====== REGISTER FONTS ======
registerFont(path.join(__dirname, 'fonts/Oswald-SemiBold.ttf'), {
  family: 'Oswald',
  weight: '600'
});

registerFont(path.join(__dirname, 'fonts/EBGaramond-Regular.ttf'), {
  family: 'EB Garamond',
  weight: '400'
});

registerFont(path.join(__dirname, 'fonts/DejaVuSerif.ttf'), {
  family: 'DejaVuSerif',
  weight: '400'
});



// ====== MAIN FUNCTION ======
async function generate() {
  // create canvas
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // load background image
  const bg = await loadImage(BG_PATH);

  // draw background
  ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);

  // add dark overlay (for readability)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // ====== TEXT SETTINGS ======
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const centerX = WIDTH / 2;

  // ====== HEADER (Oswald) ======
  ctx.font = '400 64px "Oswald"';

  console.log('Using font:', ctx.font);
  ctx.fillText('Philippians 4:6', centerX, 200);

  // ====== BODY (Garamond) ======
  ctx.font = '400 42px "EB Garamond"';

  const text = `No dey worry about anything,
                just dey pray about everything.
                Tell God wetin you need,
                thank am for all e don do.`;

  wrapText(ctx, text, centerX, 350, WIDTH * 0.7, 58);

  // save image
  fs.writeFileSync(OUTPUT, canvas.toBuffer('image/jpeg'));
  console.log('✅ Image created:', OUTPUT);
}

// ====== TEXT WRAPPER ======
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const width = ctx.measureText(testLine).width;

    if (width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  console.log('Using font:', ctx.font);
  ctx.fillText(line.trim(), x, currentY);
}

// ====== RUN ======
generate().catch(err => {
  console.error('❌ Error:', err);
});