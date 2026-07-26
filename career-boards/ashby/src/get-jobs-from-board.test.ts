import { describe, expect, it, vi } from "vitest";
import { getJobsFromBoard } from "./get-jobs-from-board";

describe("getJobsFromBoard", () => {
  it("fetches the posting-api board and normalizes jobs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
              title: "Security Engineer, Cloud",
              employmentType: "FullTime",
              location: "New York, NY (HQ)",
              isRemote: true,
              publishedAt: "2026-04-07T17:12:35.753+00:00",
              jobUrl:
                "https://jobs.ashbyhq.com/Ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
              applyUrl:
                "https://jobs.ashbyhq.com/Ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
              compensation: { compensationTierSummary: "$200K – $260K" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await getJobsFromBoard({
      careersUrl: "https://jobs.ashbyhq.com/Ramp",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.ashbyhq.com/posting-api/job-board/Ramp?includeCompensation=true",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.jobs[0]).toMatchObject({
      source: "ashby",
      externalId: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
      title: "Security Engineer, Cloud",
      employmentType: "FullTime",
      locationText: "Remote · New York, NY (HQ)",
      salary: "$200K – $260K",
      postedOn: "2026-04-07T17:12:35.753+00:00",
    });
  });

  it("throws on non-OK responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 404 }));

    await expect(
      getJobsFromBoard({
        careersUrl: "https://jobs.ashbyhq.com/Missing",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
