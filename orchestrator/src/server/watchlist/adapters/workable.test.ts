import { beforeEach, describe, expect, it, vi } from "vitest";
import { workableWatchlistAdapter } from "./workable";

describe("workableWatchlistAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses catalog sources into canonical watchlist sources", () => {
    expect(
      workableWatchlistAdapter.parseCatalogSources([
        {
          label: "Acme",
          workableUrl: "https://acme.workable.com",
        },
      ]),
    ).toEqual([
      {
        id: "workable:https://apply.workable.com/acme",
        label: "Acme",
        sourceType: "workable",
        careersUrl: "https://apply.workable.com/acme",
        cxsJobsUrl: null,
      },
    ]);
  });

  it("fetches and maps jobs, preferring the widget company name as employer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            name: "Acme Corp",
            jobs: [
              {
                shortcode: "ABC123DEF",
                title: "Platform Engineer",
                url: "https://apply.workable.com/acme/j/ABC123DEF",
                application_url:
                  "https://apply.workable.com/acme/j/ABC123DEF/apply",
                created_at: "2026-03-15T10:00:00Z",
                location: { location_str: "Remote", telecommuting: true },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await workableWatchlistAdapter.fetchJobs({
      source: {
        id: "workable:https://apply.workable.com/acme",
        catalogSourceId: null,
        label: "Acme",
        careersUrl: "https://apply.workable.com/acme",
        cxsJobsUrl: null,
        sourceType: "workable",
        isCustom: false,
        sortOrder: 0,
        createdAt: "2026-05-01T00:00:00Z",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    });

    expect(result.jobs[0]).toMatchObject({
      source: "workable:acme",
      sourceJobId: "ABC123DEF",
      employer: "Acme Corp",
      applicationLink: "https://apply.workable.com/acme/j/ABC123DEF/apply",
      location: "Remote",
    });
  });
});
