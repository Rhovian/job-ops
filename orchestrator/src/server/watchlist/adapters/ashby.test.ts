import { beforeEach, describe, expect, it, vi } from "vitest";
import { ashbyWatchlistAdapter } from "./ashby";

describe("ashbyWatchlistAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses catalog sources into canonical watchlist sources", () => {
    expect(
      ashbyWatchlistAdapter.parseCatalogSources([
        {
          label: "Ramp",
          ashbyUrl: "https://api.ashbyhq.com/posting-api/job-board/Ramp",
        },
      ]),
    ).toEqual([
      {
        id: "ashby:https://jobs.ashbyhq.com/Ramp",
        label: "Ramp",
        sourceType: "ashby",
        careersUrl: "https://jobs.ashbyhq.com/Ramp",
        cxsJobsUrl: null,
      },
    ]);
  });

  it("fetches and maps jobs from the board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
                title: "Security Engineer",
                location: "Remote",
                isRemote: true,
                publishedAt: "2026-04-07T17:12:35.753+00:00",
                jobUrl:
                  "https://jobs.ashbyhq.com/Ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
                applyUrl:
                  "https://jobs.ashbyhq.com/Ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await ashbyWatchlistAdapter.fetchJobs({
      source: {
        id: "ashby:https://jobs.ashbyhq.com/Ramp",
        catalogSourceId: null,
        label: "Ramp",
        careersUrl: "https://jobs.ashbyhq.com/Ramp",
        cxsJobsUrl: null,
        sourceType: "ashby",
        isCustom: false,
        sortOrder: 0,
        createdAt: "2026-05-01T00:00:00Z",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    });

    expect(result.jobs[0]).toMatchObject({
      source: "ashby:ramp",
      sourceJobId: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
      employer: "Ramp",
      applicationLink:
        "https://jobs.ashbyhq.com/Ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
      location: "Remote",
    });
  });
});
