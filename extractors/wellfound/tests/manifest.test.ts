import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWellfound } from "../src/run";

vi.mock("../src/run", () => ({
  runWellfound: vi.fn(),
}));

describe("wellfound manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runWellfound).mockResolvedValue({ success: true, jobs: [] });
  });

  it("registers the wellfound source", async () => {
    const { manifest } = await import("../manifest");

    expect(manifest.id).toBe("wellfound");
    expect(manifest.displayName).toBe("Wellfound");
    expect(manifest.providesSources).toEqual(["wellfound"]);
  });

  it("passes app runtime controls into runWellfound", async () => {
    const { manifest } = await import("../manifest");
    const onProgress = vi.fn();
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi
      .fn()
      .mockResolvedValue(["https://wellfound.com/jobs/existing"]);

    await manifest.run({
      source: "wellfound",
      selectedSources: ["wellfound"],
      selectedCountry: "united states",
      searchTerms: ["backend engineer"],
      settings: {
        wellfoundMaxJobsPerTerm: "12",
        searchCities: "New York|Remote",
      },
      getExistingJobUrls,
      shouldCancel,
      onProgress,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runWellfound).toHaveBeenCalledWith(
      expect.objectContaining({
        searchTerms: ["backend engineer"],
        locations: ["New York", "Remote"],
        existingJobUrls: ["https://wellfound.com/jobs/existing"],
        maxJobsPerTerm: 12,
        shouldCancel,
      }),
    );
  });

  it("surfaces challenge-required failures", async () => {
    vi.mocked(runWellfound).mockResolvedValueOnce({
      success: false,
      jobs: [],
      challengeRequired: "https://wellfound.com/role/software-engineer",
    });

    const { manifest } = await import("../manifest");
    const result = await manifest.run({
      source: "wellfound",
      selectedSources: ["wellfound"],
      selectedCountry: "united states",
      searchTerms: ["software engineer"],
      settings: {},
    });

    expect(result).toEqual({
      success: false,
      jobs: [],
      error: undefined,
      challengeRequired: "https://wellfound.com/role/software-engineer",
    });
  });
});
