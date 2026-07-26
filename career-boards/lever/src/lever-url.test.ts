import { describe, expect, it } from "vitest";
import {
  LeverUrlParseError,
  leverUrlToCompanyLabel,
  leverUrlToSourceKey,
  parseLeverJobUrl,
  parseLeverUrl,
} from "./lever-url";

const JOB_ID = "a1b2c3d4-e5f6-7a8b-9c0d-112233445566";

describe("parseLeverUrl", () => {
  it("parses a public board URL", () => {
    const parsed = parseLeverUrl("https://jobs.lever.co/acme");
    expect(parsed.company).toBe("acme");
    expect(parsed.canonicalCareersUrl).toBe("https://jobs.lever.co/acme");
    expect(parsed.postingsApiUrl).toBe(
      "https://api.lever.co/v0/postings/acme?mode=json",
    );
  });

  it("parses the api postings endpoint", () => {
    expect(parseLeverUrl("https://api.lever.co/v0/postings/acme").company).toBe(
      "acme",
    );
  });

  it("accepts a bare company slug", () => {
    expect(parseLeverUrl("acme").company).toBe("acme");
  });

  it("rejects unsupported hosts", () => {
    expect(() => parseLeverUrl("https://example.com/acme")).toThrow(
      LeverUrlParseError,
    );
  });

  it("derives label and source key", () => {
    expect(leverUrlToCompanyLabel("acme-co")).toBe("Acme Co");
    expect(leverUrlToSourceKey("Acme")).toBe("lever:acme");
  });
});

describe("parseLeverJobUrl", () => {
  it("extracts a UUID posting id", () => {
    const parsed = parseLeverJobUrl(`https://jobs.lever.co/acme/${JOB_ID}`);
    expect(parsed.jobId).toBe(JOB_ID);
    expect(parsed.jobApiUrl).toBe(
      `https://api.lever.co/v0/postings/acme/${JOB_ID}?mode=json`,
    );
  });

  it("extracts the id even with an /apply suffix", () => {
    expect(
      parseLeverJobUrl(`https://jobs.lever.co/acme/${JOB_ID}/apply`).jobId,
    ).toBe(JOB_ID);
  });

  it("throws when no posting id is present", () => {
    expect(() => parseLeverJobUrl("https://jobs.lever.co/acme")).toThrow(
      LeverUrlParseError,
    );
  });
});
