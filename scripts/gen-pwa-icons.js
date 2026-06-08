'use strict';
// Jednorázový generátor PWA ikon z client/public/favicon.svg.
// Spuštění: node scripts/gen-pwa-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pub = path.join(__dirname, '..', 'client', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'));

(async () => {
  for (const size of [192, 512]) {
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 17, g: 24, b: 39, alpha: 1 } })
      .png()
      .toFile(path.join(pub, `icon-${size}.png`));
    console.log(`icon-${size}.png hotovo`);
  }
})();
