import { classifyProcessingError } from "../classifyProcessingError";

describe("classifyProcessingError", () => {
  it("classifies a locked-file message", () => {
    expect(classifyProcessingError(["Please close the file and try again"])).toBe("file_locked");
  });

  it("classifies an API timeout message", () => {
    expect(classifyProcessingError(["API request timeout after 30000ms"])).toBe("api_timeout");
  });

  it('classifies a "timed out" message (regression: must not fall through to general)', () => {
    expect(classifyProcessingError(["Document processing timed out after 480000ms"])).toBe(
      "api_timeout"
    );
  });

  it("classifies a compatibility-mode message", () => {
    expect(classifyProcessingError(["Document uses outdated functions"])).toBe("word_compatibility");
  });

  it("falls back to general for an unrecognized message", () => {
    expect(classifyProcessingError(["Something unexpected happened"])).toBe("general");
  });

  it("returns general for empty or missing input", () => {
    expect(classifyProcessingError([])).toBe("general");
    expect(classifyProcessingError(undefined)).toBe("general");
  });

  it("prioritizes file_locked over later categories", () => {
    expect(
      classifyProcessingError(["Please close the file and try again", "request timeout"])
    ).toBe("file_locked");
  });
});
