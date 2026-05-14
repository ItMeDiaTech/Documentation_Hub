import pkg from "../../package.json";

describe("Version consistency", () => {
  it("package.json version is a valid semver", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-[\w.-]+)?$/);
  });
});
