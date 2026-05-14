const pkg = require("../package.json");
const EXPECTED = "CF863E5D-30C2-470B-B337-4373B543F563";
const actual = pkg.build?.msi?.upgradeCode;
if (actual !== EXPECTED) {
  console.error(`MSI upgradeCode mismatch: expected ${EXPECTED}, got ${actual}`);
  process.exit(1);
}
console.log("MSI upgradeCode OK");
