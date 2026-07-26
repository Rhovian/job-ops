import { describe, expect, it, vi } from "vitest";
import { getJobsFromBoard } from "./get-jobs-from-board";

describe("getJobsFromBoard", () => {
  it("fetches the postings endpoint and normalizes postings", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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
            workplaceType: "remote",
            categories: {
              commitment: "Full Time",
              location: "Remote",
              allLocations: ["Remote - US", "Remote - EU"],
            },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await getJobsFromBoard({
      careersUrl: "https://jobs.lever.co/acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/acme?mode=json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.total).toBe(1);
    expect(result.jobs[0]).toMatchObject({
      source: "lever",
      externalId: "11111111-2222-3333-4444-555555555555",
      title: "Backend Engineer",
      locationText: "Remote - US / Remote - EU",
      commitment: "Full Time",
      workplaceType: "remote",
      postedOn: "2025-01-01T00:00:00.000Z",
    });
  });

  it("throws when the company is unknown (non-array response)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false }), { status: 200 }),
      );

    await expect(
      getJobsFromBoard({
        careersUrl: "https://jobs.lever.co/missing",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not an array/);
  });
});
