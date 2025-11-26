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

        iconData.push({ size, data: pixels });
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

        // BMP data size = header(40) + pixels + mask
        const bmpSize = 40 + icon.data.length + Math.ceil(icon.size * icon.size / 8);
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

        // AND mask (all transparent = 0)
        const mask = Buffer.alloc(Math.ceil(icon.size * icon.size / 8), 0);

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
  console.log('Generating application icons from DocHub_Image.png');
  console.log('='.repeat(60));

  try {
    // Determine if we're running from the build directory or root
    const isInBuildDir = __dirname.endsWith('build');
    const rootDir = isInBuildDir ? path.join(__dirname, '..') : __dirname;
    const buildDir = path.join(rootDir, 'build');
    const sourcePath = path.join(rootDir, 'DocHub_Image.png');

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
    console.log(`✓ Copied source to icon.png: 960x960`);

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
    console.log('  • icon.png (960x960) - Base icon for electron-builder');
    console.log('  • 512x512.png - Linux icon');
    console.log('  • 256x256.png - Linux icon');
    console.log('  • icon.ico - Windows application icon');
    console.log('\nElectron-builder will auto-generate:');
    console.log('  • .icns for macOS from icon.png');
    console.log('  • Additional Windows sizes if needed');
    console.log('');
  } catch (error) {
    console.error('\n❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

// Run the script
generateIcons();
