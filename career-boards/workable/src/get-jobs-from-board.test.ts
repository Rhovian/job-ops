import { describe, expect, it, vi } from "vitest";
import { getJobsFromBoard } from "./get-jobs-from-board";

describe("getJobsFromBoard", () => {
  it("fetches the widget endpoint and normalizes jobs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Acme",
          description: null,
          jobs: [
            {
              id: 123,
              shortcode: "ABC123DEF",
              title: "Platform Engineer",
              department: "Engineering",
              url: "https://apply.workable.com/acme/j/ABC123DEF",
              application_url:
                "https://apply.workable.com/acme/j/ABC123DEF/apply",
              employment_type: "Full-time",
              telecommuting: true,
              created_at: "2026-03-15T10:00:00Z",
              location: {
                location_str: "Lisbon, Portugal",
                city: "Lisbon",
                country: "Portugal",
                telecommuting: true,
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await getJobsFromBoard({
      careersUrl: "https://apply.workable.com/acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://apply.workable.com/api/v1/widget/accounts/acme",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.companyName).toBe("Acme");
    expect(result.jobs[0]).toMatchObject({
      source: "workable",
      externalId: "ABC123DEF",
      title: "Platform Engineer",
      jobUrl: "https://apply.workable.com/acme/j/ABC123DEF",
      employmentType: "Full-time",
      isRemote: true,
      locationText: "Lisbon, Portugal",
      postedOn: "2026-03-15T10:00:00Z",
    });
  });

  it("throws on non-OK responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 404 }));

    await expect(
      getJobsFromBoard({
        careersUrl: "https://apply.workable.com/missing",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
