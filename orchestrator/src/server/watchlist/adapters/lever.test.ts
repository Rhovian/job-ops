import { beforeEach, describe, expect, it, vi } from "vitest";
import { leverWatchlistAdapter } from "./lever";

describe("leverWatchlistAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses catalog sources into canonical watchlist sources", () => {
    expect(
      leverWatchlistAdapter.parseCatalogSources([
        {
          label: "Acme",
          leverUrl: "https://api.lever.co/v0/postings/acme",
        },
      ]),
    ).toEqual([
      {
        id: "lever:https://jobs.lever.co/acme",
        label: "Acme",
        sourceType: "lever",
        careersUrl: "https://jobs.lever.co/acme",
        cxsJobsUrl: null,
      },
    ]);
  });

  it("normalizes a bare-slug custom selection to the canonical board and label", () => {
    expect(
      leverWatchlistAdapter.normalizeCustomSelection({
        label: "acme-co",
        careersUrl: "acme-co",
      }),
    ).toEqual({
      label: "Acme Co",
      careersUrl: "https://jobs.lever.co/acme-co",
    });
  });

  it("fetches and maps postings, falling back to applyUrl for application link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: "11111111-2222-3333-4444-555555555555",
              text: "Backend Engineer",
              hostedUrl:
                "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555",
              applyUrl:
                "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555/apply",
              createdAt: 1735689600000,
              categories: { location: "Remote" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await leverWatchlistAdapter.fetchJobs({
      source: {
        id: "lever:https://jobs.lever.co/acme",
        catalogSourceId: null,
        label: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
        cxsJobsUrl: null,
        sourceType: "lever",
        isCustom: false,
        sortOrder: 0,
        createdAt: "2026-05-01T00:00:00Z",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    });

    expect(result.jobs[0]).toMatchObject({
      source: "lever:acme",
      sourceJobId: "11111111-2222-3333-4444-555555555555",
      employer: "Acme",
      applicationLink:
        "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555/apply",
      location: "Remote",
    });
  });
});
