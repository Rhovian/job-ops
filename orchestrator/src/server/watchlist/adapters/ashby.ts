import {
  ashbyUrlToCompanyLabel,
  ashbyUrlToSourceKey,
  getJobDetails,
  getJobsFromBoard,
  parseAshbyUrl,
} from "@career-boards/ashby";
import type { ManualJobDraft, WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const ASHBY_WATCHLIST_MAX_JOBS = 40;

const ashbySourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  ashbyUrl: z.string().trim().min(1).max(2000),
});

export const ashbyWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "ashby",
  descriptor: {
    sourceType: "ashby",
    label: "Ashby",
    catalogLabel: "Ashby company",
    customSourceOptionLabel: "Choose your own Ashby board",
    customSourceSearchText: "custom ashby board",
    customSourceInputLabel: "Custom Ashby board URL",
    customSourcePlaceholder: "https://jobs.ashbyhq.com/Company",
    customSourceHelpText:
      'Use the public Ashby board URL (or just the organisation slug, e.g. "Ramp"), not an individual job posting URL.',
    emptyCatalogText: "No Ashby companies found.",
    fetchingLabel: "Fetching from Ashby...",
    invalidUrlMessage: "Invalid Ashby board URL",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: ashbySourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(ashbySourceSchema)
      .parse(entries)
      .map((entry) => {
        const parsed = parseAshbyUrl(entry.ashbyUrl);
        return {
          id: buildSourceId(parsed.canonicalCareersUrl),
          label: entry.label,
          sourceType: "ashby",
          careersUrl: parsed.canonicalCareersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    const parsed = parseAshbyUrl(source.careersUrl);
    return {
      ...source,
      label: getHydratedAshbyLabel(source),
      careersUrl: parsed.canonicalCareersUrl,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const parsed = parseAshbyUrl(input.careersUrl);
    const canonicalCareersUrl = parsed.canonicalCareersUrl;
    const trimmedLabel = input.label?.trim();
    const label =
      trimmedLabel && trimmedLabel !== input.careersUrl.trim()
        ? trimmedLabel
        : ashbyUrlToCompanyLabel(canonicalCareersUrl);

    return {
      label,
      careersUrl: canonicalCareersUrl,
    };
  },
  async fetchJobs(input) {
    const response = await getJobsFromBoard({
      careersUrl: input.source.careersUrl,
      signal: input.signal,
    });
    const source = ashbyUrlToSourceKey(input.source.careersUrl);
    const jobs = response.jobs.map((job) => ({
      jobRef: job.jobUrl,
      source,
      sourceJobId: job.externalId,
      sourceType: input.source.sourceType,
      title: job.title,
      employer: input.source.label,
      jobUrl: job.jobUrl,
      applicationLink: job.applyUrl ?? job.jobUrl,
      location: job.locationText ?? null,
      postedAt: job.postedOn ?? null,
    }));
    const sortedJobs = jobs
      .sort((left, right) => comparePostedAtDesc(left.postedAt, right.postedAt))
      .slice(0, ASHBY_WATCHLIST_MAX_JOBS);

    return {
      total: response.total,
      fetched: sortedJobs.length,
      jobs: sortedJobs,
    };
  },
  async fetchJobDetails(input) {
    const details = await getJobDetails({
      jobUrl: input.jobRef,
      signal: input.signal,
    });

    return {
      jobRef: input.jobRef,
      jobUrl: details.job.jobUrl,
      descriptionHtml: details.job.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const details = await getJobDetails({
      jobUrl: input.jobRef,
      signal: input.signal,
    });
    const source = ashbyUrlToSourceKey(input.source.careersUrl);
    const draft = buildManualDraft(input.source, source, details.job);

    return {
      draft,
      source: draft.source ?? null,
      sourceHost:
        getSourceHost(input.jobRef) ?? getSourceHost(input.source.careersUrl),
    };
  },
};

function buildSourceId(careersUrl: string): string {
  return `ashby:${careersUrl}`;
}

function getHydratedAshbyLabel(source: {
  sourceType: string;
  label: string;
  careersUrl: string;
}): string {
  if (
    source.sourceType === "ashby" &&
    (!source.label.trim() || source.label.trim() === source.careersUrl.trim())
  ) {
    return ashbyUrlToCompanyLabel(source.careersUrl);
  }

  return source.label;
}

function buildManualDraft(
  selectedSource: WatchlistSelectedSource,
  source: string,
  details: {
    externalId: string;
    title: string;
    jobUrl: string;
    applyUrl?: string;
    locationText?: string;
    employmentType?: string;
    salary?: string;
    jobDescriptionText: string;
  },
): ManualJobDraft {
  return {
    source,
    sourceJobId: details.externalId,
    title: details.title,
    employer: selectedSource.label,
    jobUrl: details.jobUrl,
    applicationLink: details.applyUrl ?? details.jobUrl,
    location: details.locationText,
    salary: details.salary,
    jobDescription: details.jobDescriptionText,
    jobType: details.employmentType,
  };
}

function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function comparePostedAtDesc(
  left: string | null,
  right: string | null,
): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid) return rightTime - leftTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}
