const fs = require('fs');

// Create a minimal valid 16x16 ICO file (smallest possible)
// ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
const buffer = Buffer.from([
  // ICO header
  0,0,  // Reserved
  1,0,  // Type (1 = ICO)
  1,0,  // Number of images
  // Image directory
  16,   // Width
  16,   // Height
  0,    // Color palette
  0,    // Reserved
  1,0,  // Color planes
  32,0, // Bits per pixel
  0x28,0x05,0,0, // Size of image data
  22,0,0,0,      // Offset of image data
  // BMP header (40 bytes)
  40,0,0,0,      // Header size
  16,0,0,0,      // Width
  32,0,0,0,      // Height (double for ICO)
  1,0,           // Planes
  32,0,          // Bits per pixel
  0,0,0,0,       // Compression
  0,0,0,0,       // Image size
  0,0,0,0,       // X pixels per meter
  0,0,0,0,       // Y pixels per meter
  0,0,0,0,       // Colors used
  0,0,0,0        // Important colors
]);

// Add blue pixel data (16x16 @ 32bpp = 1024 bytes BGRA)
const pixels = Buffer.alloc(1024);
for (let i = 0; i < 256; i++) {
  pixels[i*4] = 200;     // B
  pixels[i*4+1] = 100;   // G
  pixels[i*4+2] = 50;    // R
  pixels[i*4+3] = 255;   // A
}

// Add AND mask (1 bit per pixel, 16x16 = 32 bytes)
const mask = Buffer.alloc(64, 0);

fs.writeFileSync('build/icon.ico', Buffer.concat([buffer, pixels, mask]));
console.log('Created minimal icon:', fs.statSync('build/icon.ico').size, 'bytes');
