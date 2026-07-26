import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectJobNodes,
  dedupeWellfoundJobs,
  extractNextData,
  makeWellfoundSearchUrl,
  mapWellfoundJob,
  resolveWellfoundMaxJobsPerTerm,
  slugifyKeyword,
} from "../src/run";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("wellfound search urls", () => {
  it("slugifies keywords", () => {
    expect(slugifyKeyword("Senior C++ Engineer")).toBe("senior-c-engineer");
  });

  it("builds role, role+location, and remote role URLs", () => {
    expect(makeWellfoundSearchUrl({ keyword: "software engineer" })).toBe(
      "https://wellfound.com/role/software-engineer",
    );
    expect(
      makeWellfoundSearchUrl({
        keyword: "product manager",
        location: "New York",
      }),
    ).toBe("https://wellfound.com/role/l/product-manager/new-york");
    expect(
      makeWellfoundSearchUrl({ keyword: "data scientist", remoteOnly: true }),
    ).toBe("https://wellfound.com/role/r/data-scientist");
  });
});

describe("wellfound node extraction and mapping", () => {
  it("deep-walks arbitrary JSON for job-shaped nodes", () => {
    const payload = {
      props: {
        pageProps: {
          results: [
            {
              id: 42,
              slug: "senior-backend-engineer",
              title: "Senior Backend Engineer",
              remote: true,
              locationNames: ["San Francisco", "Remote"],
              liveStartAt: 1735689600,
              compensation: "$160k – $200k",
              startup: { name: "Acme", slug: "acme-inc" },
            },
            { id: 1, notAJob: true },
          ],
        },
      },
    };

    const nodes = collectJobNodes(payload);
    expect(nodes).toHaveLength(1);

    const mapped = mapWellfoundJob(nodes[0]);
    expect(mapped).toEqual(
      expect.objectContaining({
        source: "wellfound",
        sourceJobId: "42",
        title: "Senior Backend Engineer",
        employer: "Acme",
        employerUrl: "https://wellfound.com/company/acme-inc",
        jobUrl: "https://wellfound.com/jobs/42-senior-backend-engineer",
        location: "San Francisco, Remote",
        salary: "$160k – $200k",
        datePosted: "2025-01-01T00:00:00.000Z",
        isRemote: true,
      }),
    );
  });

  it("returns null for nodes without a usable url or title", () => {
    expect(
      mapWellfoundJob({ title: "No identifiers", startup: { name: "X" } }),
    ).toBeNull();
  });

  it("parses the embedded __NEXT_DATA__ document", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{"a":{"b":1}}</script></body></html>`;
    expect(extractNextData(html)).toEqual({ a: { b: 1 } });
    expect(extractNextData("<html></html>")).toBeNull();
  });

  it("dedupes by source job id or URL and filters existing URLs", () => {
    const jobs = [
      {
        source: "wellfound",
        sourceJobId: "one",
        jobUrl: "https://wellfound.com/jobs/one",
      },
      {
        source: "wellfound",
        sourceJobId: "one",
        jobUrl: "https://wellfound.com/jobs/one-copy",
      },
      { source: "wellfound", jobUrl: "https://wellfound.com/jobs/existing" },
      { source: "wellfound", jobUrl: "https://wellfound.com/jobs/fresh" },
    ];

    expect(
      dedupeWellfoundJobs(jobs, ["https://wellfound.com/jobs/existing"]).map(
        (job) => job.jobUrl,
      ),
    ).toEqual([
      "https://wellfound.com/jobs/one",
      "https://wellfound.com/jobs/fresh",
    ]);
  });

  it("normalizes the internal max jobs per term setting", () => {
    expect(resolveWellfoundMaxJobsPerTerm(undefined)).toBe(50);
    expect(resolveWellfoundMaxJobsPerTerm("12")).toBe(12);
    expect(resolveWellfoundMaxJobsPerTerm(12.9)).toBe(12);
    expect(resolveWellfoundMaxJobsPerTerm(0)).toBe(1);
    expect(resolveWellfoundMaxJobsPerTerm("not-a-number")).toBe(50);
  });

  it("does not write debug files during normal runs", async () => {
    const source = await readFile(join(testDir, "../src/run.ts"), "utf8");
    expect(source).not.toContain("writeFile");
  });
});
