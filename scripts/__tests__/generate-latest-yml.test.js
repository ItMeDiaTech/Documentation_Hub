const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..");
const releaseDir = path.join(repoRoot, "release");
const scriptPath = path.join(repoRoot, "scripts", "generate-latest-yml.js");
const pkg = require(path.join(repoRoot, "package.json"));

describe("generate-latest-yml.js", () => {
  const msiFileName = `Documentation-Hub-${pkg.version}.msi`;
  const msiPath = path.join(releaseDir, msiFileName);
  const ymlPath = path.join(releaseDir, "latest.yml");

  // Track whether we created the release dir so we know to remove it on teardown.
  let createdReleaseDir = false;
  let createdMsi = false;
  let createdYml = false;
  let preExistingMsi = false;
  let preExistingYml = false;

  beforeAll(() => {
    if (!fs.existsSync(releaseDir)) {
      fs.mkdirSync(releaseDir, { recursive: true });
      createdReleaseDir = true;
    }
    preExistingMsi = fs.existsSync(msiPath);
    preExistingYml = fs.existsSync(ymlPath);
    if (!preExistingMsi) {
      // 1 MiB of deterministic bytes so SHA512 is stable across runs.
      const buf = Buffer.alloc(1024 * 1024, 0x42);
      fs.writeFileSync(msiPath, buf);
      createdMsi = true;
    }
  });

  afterAll(() => {
    if (createdYml && fs.existsSync(ymlPath)) fs.unlinkSync(ymlPath);
    if (createdMsi && fs.existsSync(msiPath)) fs.unlinkSync(msiPath);
    if (createdReleaseDir && fs.existsSync(releaseDir)) {
      try {
        fs.rmdirSync(releaseDir);
      } catch {
        /* leave non-empty release dir alone */
      }
    }
  });

  it("emits a latest.yml whose sha512 and size match the MSI on disk", () => {
    execFileSync(process.execPath, [scriptPath], { stdio: "pipe" });
    createdYml = !preExistingYml;
    expect(fs.existsSync(ymlPath)).toBe(true);

    const yml = fs.readFileSync(ymlPath, "utf8");
    const buf = fs.readFileSync(msiPath);
    const expectedSha = crypto.createHash("sha512").update(buf).digest("base64");
    const expectedSize = fs.statSync(msiPath).size;

    expect(yml).toContain(`version: ${pkg.version}`);
    expect(yml).toContain(`sha512: ${expectedSha}`);
    expect(yml).toContain(`size: ${expectedSize}`);
    expect(yml).toContain(msiFileName);
  });
});
