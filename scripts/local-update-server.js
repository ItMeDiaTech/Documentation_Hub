/**
 * Local Update Server for Testing Delta Updates
 *
 * This simple Express server enables testing auto-updates locally.
 * It serves update files with Range request support for delta downloads.
 *
 * Usage:
 * 1. Build your app: npm run dist
 * 2. Run this server: node scripts/local-update-server.js
 * 3. Bump version and rebuild
 * 4. Run the older installed version to test updates
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8080;

// Directory where update files are served from (use the release folder)
const UPDATE_DIR = path.join(__dirname, '../release');

// Check if release directory exists
if (!fs.existsSync(UPDATE_DIR)) {
  console.log(`Release directory not found: ${UPDATE_DIR}`);
  console.log('Run "npm run dist" first to build the release files.');
}

// Enable Range requests for differential downloads
app.use('/updates', express.static(UPDATE_DIR, {
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    // Log requests for debugging
    console.log(`[${new Date().toISOString()}] Serving: ${path.basename(filePath)}`);

    // Set CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges');
  }
}));

// List available files
app.get('/', (req, res) => {
  try {
    const files = fs.readdirSync(UPDATE_DIR);
    res.send(`
      <h1>Local Update Server</h1>
      <h2>Files available at /updates/</h2>
      <ul>
        ${files.map(f => `<li><a href="/updates/${f}">${f}</a></li>`).join('')}
      </ul>
      <h2>Instructions</h2>
      <ol>
        <li>Run <code>npm run dist</code> to build release files</li>
        <li>Files are served from: <code>${UPDATE_DIR}</code></li>
        <li>Set <code>FORCE_DEV_UPDATE_CONFIG=true</code> env var</li>
        <li>Run an older installed version to test updates</li>
      </ol>
    `);
  } catch (err) {
    res.send(`
      <h1>Local Update Server</h1>
      <p>Update directory not found. Create it and add files:</p>
      <code>${UPDATE_DIR}</code>
    `);
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           Local Update Server for Delta Testing                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Server:     http://localhost:${PORT}                            ║`);
  console.log(`║  Updates:    http://localhost:${PORT}/updates/                   ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Serving from: release/                                        ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  To test: Set FORCE_DEV_UPDATE_CONFIG=true and run older app  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
});
