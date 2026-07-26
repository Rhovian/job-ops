import { describe, expect, it, vi } from "vitest";
import {
  isAtsId,
  matchesLocations,
  matchesSearchTerms,
  runAtsBoards,
} from "../src/run";

const job = (over: Record<string, unknown> = {}) =>
  ({
    source: "greenhouse",
    title: "Senior Backend Engineer",
    employer: "Acme",
    jobUrl: "https://x/1",
    location: "Remote - US",
    ...over,
  }) as never;

describe("isAtsId", () => {
  it("recognizes the four ATS ids", () => {
    expect(["greenhouse", "lever", "ashby", "workable"].every(isAtsId)).toBe(
      true,
    );
    expect(isAtsId("indeed")).toBe(false);
  });
});

describe("matchesSearchTerms", () => {
  it("matches on title tokens and is empty-permissive", () => {
    expect(matchesSearchTerms(job(), ["backend engineer"])).toBe(true);
    expect(matchesSearchTerms(job(), ["data scientist"])).toBe(false);
    expect(matchesSearchTerms(job(), [])).toBe(true);
  });

  it("matches if ANY term matches", () => {
    expect(matchesSearchTerms(job(), ["data scientist", "backend"])).toBe(true);
  });
});

describe("matchesLocations", () => {
  it("keeps remote and city matches, keeps unlocated jobs", () => {
    expect(matchesLocations(job(), ["London"])).toBe(true); // remote
    expect(matchesLocations(job({ location: "London, UK" }), ["London"])).toBe(
      true,
    );
    expect(matchesLocations(job({ location: "Berlin" }), ["London"])).toBe(
      false,
    );
    expect(matchesLocations(job({ location: undefined }), ["London"])).toBe(
      true,
    );
    expect(matchesLocations(job({ location: "Berlin" }), [])).toBe(true);
  });
});

describe("runAtsBoards", () => {
  it("sweeps catalog companies and filters by search terms", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: { total: 2 },
          jobs: [
            {
              id: 1,
              title: "Senior Backend Engineer",
              absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
              location: { name: "Remote" },
              company_name: "Acme",
              updated_at: "2026-05-01T00:00:00Z",
            },
            {
              id: 2,
              title: "Sales Manager",
              absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2",
              location: { name: "NYC" },
              company_name: "Acme",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await runAtsBoards({
      sources: ["greenhouse"],
      searchTerms: ["backend engineer"],
      catalogOverride: {
        greenhouse: [
          { label: "Acme", url: "https://job-boards.greenhouse.io/acme" },
        ],
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.success).toBe(true);
    expect(result.jobs.map((j) => j.title)).toEqual([
      "Senior Backend Engineer",
    ]);
    expect(result.jobs[0]).toMatchObject({
      source: "greenhouse",
      employer: "Acme",
      jobUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      location: "Remote",
    });
  });

  it("records a source error but still succeeds when a board fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 404 }));

    const result = await runAtsBoards({
      sources: ["greenhouse"],
      searchTerms: [],
      catalogOverride: {
        greenhouse: [
          { label: "Dead Co", url: "https://job-boards.greenhouse.io/deadco" },
        ],
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(result.sourceErrors?.[0]).toContain("greenhouse:Dead Co");
  });

  it("caps admitted jobs across a source's company sweep", async () => {
    const fetchImpl = vi.fn((url: string) => {
      const board = url.includes("/beta/") ? "beta" : "acme";
      const idOffset = board === "beta" ? 100 : 0;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: Array.from({ length: 3 }, (_, index) => ({
              id: idOffset + index + 1,
              title: `Backend Engineer ${index + 1}`,
              absolute_url: `https://job-boards.greenhouse.io/${board}/jobs/${index + 1}`,
              location: { name: "Remote" },
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    const result = await runAtsBoards({
      sources: ["greenhouse"],
      maxCompaniesPerSource: 2,
      maxJobsPerCompany: 3,
      maxJobsPerSource: 4,
      catalogOverride: {
        greenhouse: [
          { label: "Acme", url: "https://job-boards.greenhouse.io/acme" },
          { label: "Beta", url: "https://job-boards.greenhouse.io/beta" },
        ],
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(4);
  });
});
