import {
  getJobDetails,
  getJobsFromBoard,
  leverUrlToCompanyLabel,
  leverUrlToSourceKey,
  parseLeverUrl,
} from "@career-boards/lever";
import type { ManualJobDraft, WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const LEVER_WATCHLIST_MAX_JOBS = 40;

const leverSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  leverUrl: z.string().trim().min(1).max(2000),
});

export const leverWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "lever",
  descriptor: {
    sourceType: "lever",
    label: "Lever",
    catalogLabel: "Lever company",
    customSourceOptionLabel: "Choose your own Lever board",
    customSourceSearchText: "custom lever board",
    customSourceInputLabel: "Custom Lever board URL",
    customSourcePlaceholder: "https://jobs.lever.co/company",
    customSourceHelpText:
      'Use the public Lever board URL (or just the company slug, e.g. "acme"), not an individual job posting URL.',
    emptyCatalogText: "No Lever companies found.",
    fetchingLabel: "Fetching from Lever...",
    invalidUrlMessage: "Invalid Lever board URL",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: leverSourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(leverSourceSchema)
      .parse(entries)
      .map((entry) => {
        const parsed = parseLeverUrl(entry.leverUrl);
        return {
          id: buildSourceId(parsed.canonicalCareersUrl),
          label: entry.label,
          sourceType: "lever",
          careersUrl: parsed.canonicalCareersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    const parsed = parseLeverUrl(source.careersUrl);
    return {
      ...source,
      label: getHydratedLeverLabel(source),
      careersUrl: parsed.canonicalCareersUrl,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const parsed = parseLeverUrl(input.careersUrl);
    const canonicalCareersUrl = parsed.canonicalCareersUrl;
    const trimmedLabel = input.label?.trim();
    const label =
      trimmedLabel && trimmedLabel !== input.careersUrl.trim()
        ? trimmedLabel
        : leverUrlToCompanyLabel(canonicalCareersUrl);

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
    const source = leverUrlToSourceKey(input.source.careersUrl);
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
      .slice(0, LEVER_WATCHLIST_MAX_JOBS);

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
    const source = leverUrlToSourceKey(input.source.careersUrl);
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
  return `lever:${careersUrl}`;
}

function getHydratedLeverLabel(source: {
  sourceType: string;
  label: string;
  careersUrl: string;
}): string {
  if (
    source.sourceType === "lever" &&
    (!source.label.trim() || source.label.trim() === source.careersUrl.trim())
  ) {
    return leverUrlToCompanyLabel(source.careersUrl);
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
    commitment?: string;
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
    jobDescription: details.jobDescriptionText,
    jobType: details.commitment,
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
