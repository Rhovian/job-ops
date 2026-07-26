import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAtsBoards } from "../src/run";

vi.mock("../src/run", async () => {
  const actual =
    await vi.importActual<typeof import("../src/run")>("../src/run");
  return { ...actual, runAtsBoards: vi.fn() };
});

describe("atsboards manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runAtsBoards).mockResolvedValue({ success: true, jobs: [] });
  });

  it("provides the four ATS pipeline sources", async () => {
    const { manifest } = await import("../manifest");
    expect(manifest.id).toBe("atsboards");
    expect(manifest.providesSources).toEqual([
      "greenhouse",
      "lever",
      "ashby",
      "workable",
    ]);
  });

  it("keeps ATS caps intact for a 25-city proximity plan", async () => {
    const { manifest } = await import("../manifest");
    const shouldCancel = vi.fn(() => false);
    const getExistingJobUrls = vi.fn().mockResolvedValue(["https://x/seen"]);
    const requestedCities = Array.from(
      { length: 25 },
      (_, index) => `Nearby city ${index + 1}`,
    );

    await manifest.run({
      source: "greenhouse",
      selectedSources: ["greenhouse", "lever", "indeed"],
      selectedCountry: "united states",
      searchTerms: ["backend engineer"],
      settings: {
        searchCities: "New York|Remote",
        atsboardsMaxCompanies: "50",
        atsboardsMaxJobsPerCompany: "20",
        atsboardsConcurrency: "4",
      },
      sourceLocationPlan: {
        requestedCities,
      } as never,
      getExistingJobUrls,
      shouldCancel,
    });

    expect(getExistingJobUrls).toHaveBeenCalledOnce();
    expect(runAtsBoards).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["greenhouse", "lever"],
        searchTerms: ["backend engineer"],
        locations: requestedCities,
        maxCompaniesPerSource: 50,
        maxJobsPerCompany: 20,
        concurrency: 4,
        existingJobUrls: ["https://x/seen"],
        shouldCancel,
      }),
    );
  });

  it("returns empty without calling run when no ATS source is selected", async () => {
    const { manifest } = await import("../manifest");
    const result = await manifest.run({
      source: "indeed",
      selectedSources: ["indeed", "linkedin"],
      selectedCountry: "united states",
      searchTerms: ["x"],
      settings: {},
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runAtsBoards).not.toHaveBeenCalled();
  });
});
