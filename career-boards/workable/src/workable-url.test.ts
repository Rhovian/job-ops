import { describe, expect, it } from "vitest";
import {
  parseWorkableJobUrl,
  parseWorkableUrl,
  WorkableUrlParseError,
  workableUrlToCompanyLabel,
  workableUrlToSourceKey,
} from "./workable-url";

describe("parseWorkableUrl", () => {
  it("parses a public board URL", () => {
    const parsed = parseWorkableUrl("https://apply.workable.com/acme");
    expect(parsed.account).toBe("acme");
    expect(parsed.canonicalCareersUrl).toBe("https://apply.workable.com/acme");
    expect(parsed.widgetApiUrl).toBe(
      "https://apply.workable.com/api/v1/widget/accounts/acme",
    );
  });

  it("parses the widget API endpoint", () => {
    expect(
      parseWorkableUrl("https://apply.workable.com/api/v1/widget/accounts/acme")
        .account,
    ).toBe("acme");
  });

  it("parses the legacy subdomain host", () => {
    expect(parseWorkableUrl("https://acme.workable.com").account).toBe("acme");
  });

  it("accepts a bare account slug", () => {
    expect(parseWorkableUrl("acme").account).toBe("acme");
  });

  it("rejects unsupported hosts", () => {
    expect(() => parseWorkableUrl("https://example.com/acme")).toThrow(
      WorkableUrlParseError,
    );
  });

  it("derives label and source key", () => {
    expect(workableUrlToCompanyLabel("acme-co")).toBe("Acme Co");
    expect(workableUrlToSourceKey("Acme")).toBe("workable:acme");
  });
});

describe("parseWorkableJobUrl", () => {
  it("extracts a shortcode from a /j/ URL", () => {
    const parsed = parseWorkableJobUrl(
      "https://apply.workable.com/acme/j/ABC123DEF",
    );
    expect(parsed.shortcode).toBe("ABC123DEF");
    expect(parsed.canonicalJobUrl).toBe(
      "https://apply.workable.com/acme/j/ABC123DEF",
    );
  });

  it("throws when no shortcode is present", () => {
    expect(() =>
      parseWorkableJobUrl("https://apply.workable.com/acme"),
    ).toThrow(WorkableUrlParseError);
  });
});
