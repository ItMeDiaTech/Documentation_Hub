const fs = require('fs');

// Create a 256x256 ICO file (required for Linux AppImage)
const size = 256;
const pixelCount = size * size;
const pixelBytes = pixelCount * 4; // 32bpp BGRA
const maskBytes = Math.ceil(pixelCount / 8);

// ICO header
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // Reserved
header.writeUInt16LE(1, 2);      // Type (1 = ICO)
header.writeUInt16LE(1, 4);      // Number of images

// Image directory entry
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0, 0);       // Width (0 = 256)
dirEntry.writeUInt8(0, 1);       // Height (0 = 256)
dirEntry.writeUInt8(0, 2);       // Color palette
dirEntry.writeUInt8(0, 3);       // Reserved
dirEntry.writeUInt16LE(1, 4);    // Color planes
dirEntry.writeUInt16LE(32, 6);   // Bits per pixel
const imageSize = 40 + pixelBytes + maskBytes;
dirEntry.writeUInt32LE(imageSize, 8);  // Size of image data
dirEntry.writeUInt32LE(22, 12);  // Offset of image data

// BMP Info header (40 bytes)
const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);         // Header size
bmpHeader.writeInt32LE(size, 4);        // Width
bmpHeader.writeInt32LE(size * 2, 8);    // Height (doubled for ICO)
bmpHeader.writeUInt16LE(1, 12);         // Planes
bmpHeader.writeUInt16LE(32, 14);        // Bits per pixel
bmpHeader.writeUInt32LE(0, 16);         // Compression (BI_RGB)
bmpHeader.writeUInt32LE(pixelBytes, 20); // Image size

// Pixel data (256x256 @ 32bpp = 262,144 bytes BGRA)
// Create a gradient blue document icon
const pixels = Buffer.alloc(pixelBytes);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // Create a blue-to-light-blue gradient
    const gradient = Math.floor(150 + (y / size) * 105);
    pixels[i] = gradient;        // B
    pixels[i + 1] = gradient - 50; // G
    pixels[i + 2] = gradient - 100; // R
    pixels[i + 3] = 255;         // A (fully opaque)
  }
}

// AND mask (1 bit per pixel)
const mask = Buffer.alloc(maskBytes, 0);

fs.writeFileSync('build/icon.ico', Buffer.concat([header, dirEntry, bmpHeader, pixels, mask]));
console.log('Created 256x256 icon:', fs.statSync('build/icon.ico').size, 'bytes');
