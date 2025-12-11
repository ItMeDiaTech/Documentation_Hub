const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

// This script generates latest.yml for MSI builds
// Run after electron-builder completes

const releaseDir = path.join(__dirname, '..', 'release');
const packageJson = require('../package.json');
const version = packageJson.version;

// Find the MSI file
const msiFileName = `Documentation-Hub-${version}.msi`;
const msiPath = path.join(releaseDir, msiFileName);

if (!fs.existsSync(msiPath)) {
  console.error(`MSI file not found: ${msiPath}`);
  process.exit(1);
}

// Calculate SHA512 hash
const fileBuffer = fs.readFileSync(msiPath);
const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
const size = fs.statSync(msiPath).size;

// Generate latest.yml content
const latestYml = {
  version: version,
  files: [
    {
      url: msiFileName,
      sha512: sha512,
      size: size
    }
  ],
  path: msiFileName,
  sha512: sha512,
  releaseDate: new Date().toISOString()
};

// Write latest.yml
const ymlPath = path.join(releaseDir, 'latest.yml');
fs.writeFileSync(ymlPath, yaml.dump(latestYml));

console.log(`Generated latest.yml for ${msiFileName}`);
console.log(`SHA512: ${sha512}`);
console.log(`Size: ${size}`);
