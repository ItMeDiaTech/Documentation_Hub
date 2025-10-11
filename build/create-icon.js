const fs = require('fs');
const path = require('path');

// Create a high-resolution PNG icon (1024x1024) for electron-builder
// This will be used to auto-generate platform-specific icons
function createPNG(size, filename) {
  // PNG file structure
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // Create image data - gradient background with "DH" text representation
  const imageData = [];
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Create circular gradient background
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      let r, g, b, a;

      if (distance < radius) {
        // Inside circle - gradient from dark blue to light blue
        const gradient = 1 - (distance / radius);
        r = Math.floor(20 + gradient * 60);  // 20-80
        g = Math.floor(40 + gradient * 120); // 40-160
        b = Math.floor(80 + gradient * 170); // 80-250
        a = 255;

        // Simple "DH" pattern in the center (Documentation Hub)
        const relX = x - centerX + radius;
        const relY = y - centerY + radius;
        const inLetterArea =
          // D shape
          (relX > radius * 0.3 && relX < radius * 0.5 &&
           relY > radius * 0.7 && relY < radius * 1.3) ||
          (relX > radius * 0.5 && relX < radius * 0.7 &&
           relY > radius * 0.8 && relY < radius * 1.2 &&
           Math.sqrt(Math.pow(relX - radius * 0.5, 2) + Math.pow(relY - radius, 2)) < radius * 0.25) ||
          // H shape
          (relX > radius * 1.0 && relX < radius * 1.1 &&
           relY > radius * 0.7 && relY < radius * 1.3) ||
          (relX > radius * 1.3 && relX < radius * 1.4 &&
           relY > radius * 0.7 && relY < radius * 1.3) ||
          (relX > radius * 1.0 && relX < radius * 1.4 &&
           relY > radius * 0.95 && relY < radius * 1.05);

        if (inLetterArea) {
          // White letters
          r = 255;
          g = 255;
          b = 255;
        }
      } else {
        // Outside circle - transparent
        r = g = b = 0;
        a = 0;
      }

      imageData.push(r, g, b, a);
    }
  }

  // Helper function to create CRC32 checksum
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = [];

    // Generate CRC table
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }

    // Calculate CRC
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Create IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = Buffer.concat([
    Buffer.from('IHDR'),
    ihdr,
    Buffer.alloc(4)
  ]);
  ihdrChunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IHDR'), ihdr])), 17);

  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);

  // Create IDAT chunk (compressed image data)
  const zlib = require('zlib');
  const rawData = Buffer.from(imageData);

  // Add filter bytes (0 = no filter) for each row
  const filteredData = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) {
    filteredData[row * (size * 4 + 1)] = 0; // filter type
    rawData.copy(filteredData, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }

  const compressedData = zlib.deflateSync(filteredData);

  const idatChunk = Buffer.concat([
    Buffer.from('IDAT'),
    compressedData,
    Buffer.alloc(4)
  ]);
  idatChunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IDAT'), compressedData])), compressedData.length + 4);

  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressedData.length, 0);

  // Create IEND chunk
  const iendChunk = Buffer.concat([
    Buffer.from('IEND'),
    Buffer.alloc(4)
  ]);
  iendChunk.writeUInt32BE(crc32(Buffer.from('IEND')), 4);

  const iendLength = Buffer.alloc(4);
  iendLength.writeUInt32BE(0, 0);

  // Combine all chunks
  const png = Buffer.concat([
    PNG_SIGNATURE,
    ihdrLength,
    ihdrChunk,
    idatLength,
    idatChunk,
    iendLength,
    iendChunk
  ]);

  fs.writeFileSync(filename, png);
  console.log(`Created ${filename}: ${fs.statSync(filename).size} bytes (${size}x${size})`);
}

// Create ICO file from PNG data for Windows
function createICO() {
  // Create smaller icons for ICO format
  const sizes = [16, 32, 48, 256];
  const iconData = [];

  sizes.forEach(size => {
    // Create simple colored square for each size
    const pixels = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      // Gradient effect
      const y = Math.floor(i / size);
      const x = i % size;
      const gradient = (x + y) / (size * 2);

      pixels[i * 4] = Math.floor(50 + gradient * 150);     // B
      pixels[i * 4 + 1] = Math.floor(100 + gradient * 100); // G
      pixels[i * 4 + 2] = Math.floor(200 - gradient * 100); // R
      pixels[i * 4 + 3] = 255;                              // A
    }
    iconData.push({ size, data: pixels });
  });

  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type (1 = ICO)
  header.writeUInt16LE(iconData.length, 4); // Number of images

  // Calculate offsets
  let offset = 6 + (16 * iconData.length); // Header + directory entries
  const directories = [];
  const images = [];

  iconData.forEach(icon => {
    // Directory entry
    const dir = Buffer.alloc(16);
    dir[0] = icon.size < 256 ? icon.size : 0; // Width (0 = 256)
    dir[1] = icon.size < 256 ? icon.size : 0; // Height (0 = 256)
    dir[2] = 0; // Color palette
    dir[3] = 0; // Reserved
    dir.writeUInt16LE(1, 4); // Color planes
    dir.writeUInt16LE(32, 6); // Bits per pixel

    // BMP data size = header(40) + pixels + mask
    const bmpSize = 40 + icon.data.length + Math.ceil(icon.size * icon.size / 8);
    dir.writeUInt32LE(bmpSize, 8); // Size
    dir.writeUInt32LE(offset, 12); // Offset

    directories.push(dir);

    // BMP header
    const bmpHeader = Buffer.alloc(40);
    bmpHeader.writeInt32LE(40, 0); // Header size
    bmpHeader.writeInt32LE(icon.size, 4); // Width
    bmpHeader.writeInt32LE(icon.size * 2, 8); // Height (doubled for ICO)
    bmpHeader.writeUInt16LE(1, 12); // Planes
    bmpHeader.writeUInt16LE(32, 14); // Bits per pixel
    bmpHeader.writeUInt32LE(0, 16); // Compression
    bmpHeader.writeUInt32LE(icon.data.length, 20); // Image size

    // AND mask (all transparent = 0)
    const mask = Buffer.alloc(Math.ceil(icon.size * icon.size / 8), 0);

    images.push(Buffer.concat([bmpHeader, icon.data, mask]));
    offset += bmpSize;
  });

  // Combine all parts
  const ico = Buffer.concat([header, ...directories, ...images]);

  const isInBuildDir = __dirname.endsWith('build');
  const icoPath = isInBuildDir ? 'icon.ico' : 'build/icon.ico';

  fs.writeFileSync(icoPath, ico);
  console.log(`Created ${icoPath}:`, fs.statSync(icoPath).size, 'bytes');
}

// Main execution
console.log('Generating application icons...');

// Determine if we're running from the build directory or root
const isInBuildDir = __dirname.endsWith('build');
const iconPath = isInBuildDir ? '' : 'build/';

// Create high-resolution PNG for electron-builder (will auto-generate platform icons)
createPNG(1024, `${iconPath}icon.png`);

// Create smaller PNG versions for Linux
createPNG(512, `${iconPath}512x512.png`);
createPNG(256, `${iconPath}256x256.png`);

// Create ICO for Windows
createICO();

console.log('\n✅ Icons generated successfully!');
console.log('- icon.png (1024x1024): Base icon for auto-generation');
console.log('- icon.ico: Windows application icon');
console.log('- Additional PNG sizes for Linux');
console.log('\nElectron-builder will auto-generate .icns for macOS from icon.png');