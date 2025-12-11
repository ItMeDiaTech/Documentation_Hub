const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// Convert PNG to ICO format for Windows
function createICOFromPNG(pngPath, icoPath, sizes = [16, 32, 48, 256]) {
  return new Promise(async (resolve, reject) => {
    try {
      const sourceImage = await loadImage(pngPath);
      const iconData = [];

      // Generate each size
      for (const size of sizes) {
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Enable high-quality image scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw resized image
        ctx.drawImage(sourceImage, 0, 0, size, size);

        // Get RGBA pixel data
        const imageData = ctx.getImageData(0, 0, size, size);
        const pixels = Buffer.alloc(size * size * 4);

        // Convert RGBA to BGRA for ICO format
        for (let i = 0; i < imageData.data.length; i += 4) {
          pixels[i] = imageData.data[i + 2];     // B
          pixels[i + 1] = imageData.data[i + 1]; // G
          pixels[i + 2] = imageData.data[i];     // R
          pixels[i + 3] = imageData.data[i + 3]; // A
        }

        iconData.push({ size, data: pixels, imageData });
      }

      // ICO header
      const header = Buffer.alloc(6);
      header.writeUInt16LE(0, 0); // Reserved
      header.writeUInt16LE(1, 2); // Type (1 = ICO)
      header.writeUInt16LE(iconData.length, 4); // Number of images

      // Calculate offsets
      let offset = 6 + (16 * iconData.length);
      const directories = [];
      const images = [];

      iconData.forEach(icon => {
        // Directory entry
        const dir = Buffer.alloc(16);
        dir[0] = icon.size < 256 ? icon.size : 0; // Width
        dir[1] = icon.size < 256 ? icon.size : 0; // Height
        dir[2] = 0; // Color palette
        dir[3] = 0; // Reserved
        dir.writeUInt16LE(1, 4); // Color planes
        dir.writeUInt16LE(32, 6); // Bits per pixel

        // BMP data size = header(40) + pixels + mask (DWORD-aligned rows)
        const maskRowSize = Math.ceil(Math.ceil(icon.size / 8) / 4) * 4;
        const bmpSize = 40 + icon.data.length + (maskRowSize * icon.size);
        dir.writeUInt32LE(bmpSize, 8);
        dir.writeUInt32LE(offset, 12);

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

        // Generate AND mask from alpha channel
        // ICO AND mask: 1 = transparent, 0 = opaque
        // Rows must be DWORD (4-byte) aligned
        const rowSize = Math.ceil(icon.size / 8);
        const alignedRowSize = Math.ceil(rowSize / 4) * 4;
        const mask = Buffer.alloc(alignedRowSize * icon.size, 0);

        // BMP stores rows bottom-up, so we need to flip vertically
        for (let y = 0; y < icon.size; y++) {
          const srcRow = icon.size - 1 - y; // Flip vertically for BMP format
          for (let x = 0; x < icon.size; x++) {
            const pixelIndex = (srcRow * icon.size + x) * 4;
            const alpha = icon.imageData.data[pixelIndex + 3];

            // If pixel is transparent (alpha < 128), set mask bit to 1
            if (alpha < 128) {
              const byteIndex = y * alignedRowSize + Math.floor(x / 8);
              const bitIndex = 7 - (x % 8); // MSB first within each byte
              mask[byteIndex] |= (1 << bitIndex);
            }
          }
        }

        images.push(Buffer.concat([bmpHeader, icon.data, mask]));
        offset += bmpSize;
      });

      // Combine all parts
      const ico = Buffer.concat([header, ...directories, ...images]);
      fs.writeFileSync(icoPath, ico);
      console.log(`✓ Created ${path.basename(icoPath)}: ${fs.statSync(icoPath).size.toLocaleString()} bytes`);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// Resize PNG image to specified size
async function resizePNG(sourcePath, targetPath, targetSize) {
  try {
    const sourceImage = await loadImage(sourcePath);
    const canvas = createCanvas(targetSize, targetSize);
    const ctx = canvas.getContext('2d');

    // Enable high-quality image scaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw resized image
    ctx.drawImage(sourceImage, 0, 0, targetSize, targetSize);

    // Save as PNG
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(targetPath, buffer);
    console.log(`✓ Created ${path.basename(targetPath)}: ${targetSize}x${targetSize} (${fs.statSync(targetPath).size.toLocaleString()} bytes)`);
  } catch (error) {
    console.error(`✗ Error creating ${path.basename(targetPath)}:`, error.message);
    throw error;
  }
}

// Main execution
async function generateIcons() {
  console.log('='.repeat(60));
  console.log('Generating application icons from icon_1024x1024.png');
  console.log('='.repeat(60));

  try {
    // Determine if we're running from the build directory or root
    const isInBuildDir = __dirname.endsWith('build');
    const rootDir = isInBuildDir ? path.join(__dirname, '..') : __dirname;
    const buildDir = path.join(rootDir, 'build');
    const sourcePath = path.join(buildDir, 'icon_1024x1024.png');

    // Verify source file exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    console.log(`\nSource: ${path.basename(sourcePath)}`);
    console.log(`Build directory: ${buildDir}`);

    // Ensure build directory exists
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
      console.log('✓ Created build directory');
    }

    console.log('\nGenerating icon files...\n');

    // Copy original as base icon.png (electron-builder will use this)
    const baseIconPath = path.join(buildDir, 'icon.png');
    fs.copyFileSync(sourcePath, baseIconPath);
    console.log(`+ Copied source to icon.png: 1024x1024`);

    // Generate standard sizes
    await resizePNG(sourcePath, path.join(buildDir, '512x512.png'), 512);
    await resizePNG(sourcePath, path.join(buildDir, '256x256.png'), 256);

    // Generate Windows ICO file
    console.log('\nGenerating Windows ICO file...\n');
    await createICOFromPNG(sourcePath, path.join(buildDir, 'icon.ico'));

    console.log('\n' + '='.repeat(60));
    console.log('✅ Icons generated successfully!');
    console.log('='.repeat(60));
    console.log('\nGenerated files:');
    console.log('  - icon.png (1024x1024) - Base icon for electron-builder');
    console.log('  - 512x512.png - Linux icon');
    console.log('  - 256x256.png - Linux icon');
    console.log('  - icon.ico - Windows application icon');
    console.log('\nElectron-builder will auto-generate:');
    console.log('  - .icns for macOS from icon.png');
    console.log('  - Additional Windows sizes if needed');
    console.log('');
  } catch (error) {
    console.error('\n❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

// Run the script
generateIcons();
