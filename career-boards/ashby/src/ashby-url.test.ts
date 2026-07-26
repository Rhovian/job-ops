import { describe, expect, it } from "vitest";
import {
  AshbyUrlParseError,
  ashbyUrlToCompanyLabel,
  ashbyUrlToSourceKey,
  parseAshbyJobUrl,
  parseAshbyUrl,
} from "./ashby-url";

const JOB_ID = "34413f8d-26bf-4bbc-8ade-eb309a0e2245";

describe("parseAshbyUrl", () => {
  it("parses a public board URL and preserves org casing", () => {
    const parsed = parseAshbyUrl("https://jobs.ashbyhq.com/Ramp");
    expect(parsed.org).toBe("Ramp");
    expect(parsed.canonicalCareersUrl).toBe("https://jobs.ashbyhq.com/Ramp");
    expect(parsed.boardApiUrl).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/Ramp?includeCompensation=true",
    );
  });

  it("parses the posting-api board endpoint", () => {
    expect(
      parseAshbyUrl("https://api.ashbyhq.com/posting-api/job-board/Ramp").org,
    ).toBe("Ramp");
  });

  it("accepts a bare org slug", () => {
    expect(parseAshbyUrl("Ramp").org).toBe("Ramp");
  });

  it("rejects unsupported hosts", () => {
    expect(() => parseAshbyUrl("https://example.com/Ramp")).toThrow(
      AshbyUrlParseError,
    );
  });

  it("derives label and source key", () => {
    expect(ashbyUrlToCompanyLabel("acme-co")).toBe("Acme Co");
    expect(ashbyUrlToSourceKey("Ramp")).toBe("ashby:ramp");
  });
});

describe("parseAshbyJobUrl", () => {
  it("extracts a UUID posting id", () => {
    const parsed = parseAshbyJobUrl(`https://jobs.ashbyhq.com/Ramp/${JOB_ID}`);
    expect(parsed.jobId).toBe(JOB_ID);
    expect(parsed.canonicalJobUrl).toBe(
      `https://jobs.ashbyhq.com/Ramp/${JOB_ID}`,
    );
  });

  it("throws when no posting id is present", () => {
    expect(() => parseAshbyJobUrl("https://jobs.ashbyhq.com/Ramp")).toThrow(
      AshbyUrlParseError,
    );
  });
});
