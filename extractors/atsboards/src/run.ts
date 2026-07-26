import { getJobsFromBoard as ashbyBoard } from "@career-boards/ashby";
import { getJobsFromBoard as greenhouseBoard } from "@career-boards/greenhouse";
import { getJobsFromBoard as leverBoard } from "@career-boards/lever";
import { getJobsFromBoard as workableBoard } from "@career-boards/workable";
import {
  matchesRequestedCity,
  normalizeLocationToken,
} from "job-ops-shared/search-cities";
import type { CreateJobInput } from "job-ops-shared/types/jobs";
import { type AtsId, type CatalogCompany, readCatalog } from "./catalog";

const ATS_IDS: AtsId[] = ["greenhouse", "lever", "ashby", "workable"];
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COMPANIES_PER_SOURCE = 25;
const DEFAULT_MAX_JOBS_PER_COMPANY = 25;
const DEFAULT_MAX_JOBS_PER_SOURCE = 50;

export function isAtsId(value: string): value is AtsId {
  return (ATS_IDS as string[]).includes(value);
}

export type AtsBoardsProgressEvent =
  | {
      type: "source_start";
      ats: AtsId;
      sourceIndex: number;
      sourceTotal: number;
      companiesTotal: number;
    }
  | {
      type: "company_done";
      ats: AtsId;
      sourceIndex: number;
      sourceTotal: number;
      companiesProcessed: number;
      companiesTotal: number;
      jobsCollected: number;
    }
  | {
      type: "source_complete";
      ats: AtsId;
      sourceIndex: number;
      sourceTotal: number;
      jobsCollected: number;
    };

export interface RunAtsBoardsOptions {
  sources?: string[];
  searchTerms?: string[];
  locations?: string[];
  maxCompaniesPerSource?: number;
  maxJobsPerCompany?: number;
  maxJobsPerSource?: number;
  concurrency?: number;
  existingJobUrls?: string[];
  shouldCancel?: () => boolean;
  onProgress?: (event: AtsBoardsProgressEvent) => void;
  fetchImpl?: typeof fetch;
  /** Test seam: override catalog companies instead of reading from disk. */
  catalogOverride?: Partial<Record<AtsId, CatalogCompany[]>>;
}

export interface AtsBoardsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
  sourceErrors?: string[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearchTerms(
  job: CreateJobInput,
  searchTerms: string[],
): boolean {
  if (searchTerms.length === 0) return true;
  const haystack = normalizeText(
    [job.title, job.employer, job.location].filter(Boolean).join(" "),
  );
  if (!haystack) return false;
  return searchTerms.some((term) => {
    const normalized = normalizeText(term);
    if (!normalized) return true;
    if (haystack.includes(normalized)) return true;
    return normalized
      .split(" ")
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });
}

export function matchesLocations(
  job: CreateJobInput,
  locations: string[],
): boolean {
  if (locations.length === 0) return true;
  const location = job.location;
  // Keep jobs without a parseable location rather than over-filtering.
  if (!location) return true;
  if (/remote/i.test(location)) return true;
  const normalizedLocation = normalizeLocationToken(location);
  return locations.some((city) => {
    if (matchesRequestedCity(location, city)) return true;
    const normalizedCity = normalizeLocationToken(city);
    return (
      !!normalizedCity &&
      !!normalizedLocation &&
      normalizedLocation.includes(normalizedCity)
    );
  });
}

async function sweepCompanyJobs(
  ats: AtsId,
  company: CatalogCompany,
  fetchImpl?: typeof fetch,
): Promise<CreateJobInput[]> {
  if (ats === "greenhouse") {
    const result = await greenhouseBoard({
      careersUrl: company.url,
      fetchImpl,
    });
    return result.jobs.map((job) => ({
      source: "greenhouse",
      sourceJobId: job.externalId,
      title: job.title,
      employer: job.company ?? company.label,
      jobUrl: job.jobUrl,
      applicationLink: job.jobUrl,
      location: job.locationText,
      datePosted: job.postedOn,
    }));
  }
  if (ats === "lever") {
    const result = await leverBoard({ careersUrl: company.url, fetchImpl });
    return result.jobs.map((job) => ({
      source: "lever",
      sourceJobId: job.externalId,
      title: job.title,
      employer: company.label,
      jobUrl: job.jobUrl,
      applicationLink: job.applyUrl ?? job.jobUrl,
      location: job.locationText,
      jobType: job.commitment,
      datePosted: job.postedOn,
      isRemote: job.workplaceType
        ? /remote/i.test(job.workplaceType)
        : undefined,
    }));
  }
  if (ats === "ashby") {
    const result = await ashbyBoard({ careersUrl: company.url, fetchImpl });
    return result.jobs.map((job) => ({
      source: "ashby",
      sourceJobId: job.externalId,
      title: job.title,
      employer: company.label,
      jobUrl: job.jobUrl,
      applicationLink: job.applyUrl ?? job.jobUrl,
      location: job.locationText,
      jobType: job.employmentType,
      salary: job.salary,
      datePosted: job.postedOn,
    }));
  }
  const result = await workableBoard({ careersUrl: company.url, fetchImpl });
  const employer = result.companyName ?? company.label;
  return result.jobs.map((job) => ({
    source: "workable",
    sourceJobId: job.externalId,
    title: job.title,
    employer,
    jobUrl: job.jobUrl,
    applicationLink: job.applyUrl ?? job.jobUrl,
    location: job.locationText,
    jobType: job.employmentType,
    datePosted: job.postedOn,
    isRemote: job.isRemote || undefined,
  }));
}

function toPositiveIntOrFallback(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

export async function runAtsBoards(
  options: RunAtsBoardsOptions = {},
): Promise<AtsBoardsResult> {
  const selected = (options.sources ?? ATS_IDS).filter(isAtsId);
  const sources =
    selected.length > 0 ? Array.from(new Set(selected)) : [...ATS_IDS];
  const searchTerms = (options.searchTerms ?? [])
    .map((term) => term.trim())
    .filter(Boolean);
  const locations = (options.locations ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const concurrency = toPositiveIntOrFallback(
    options.concurrency,
    DEFAULT_CONCURRENCY,
  );
  const maxJobsPerCompany = toPositiveIntOrFallback(
    options.maxJobsPerCompany,
    DEFAULT_MAX_JOBS_PER_COMPANY,
  );
  const maxJobsPerSource = toPositiveIntOrFallback(
    options.maxJobsPerSource,
    DEFAULT_MAX_JOBS_PER_SOURCE,
  );
  const maxCompanies = toPositiveIntOrFallback(
    options.maxCompaniesPerSource,
    DEFAULT_MAX_COMPANIES_PER_SOURCE,
  );

  const existingUrls = new Set(options.existingJobUrls ?? []);
  const seen = new Set<string>();
  const jobs: CreateJobInput[] = [];
  const sourceErrors: string[] = [];

  try {
    for (const [sourceIndex, ats] of sources.entries()) {
      if (options.shouldCancel?.()) break;

      const allCompanies =
        options.catalogOverride?.[ats] ?? (await readCatalog(ats));
      const companies = maxCompanies
        ? allCompanies.slice(0, maxCompanies)
        : allCompanies;

      options.onProgress?.({
        type: "source_start",
        ats,
        sourceIndex: sourceIndex + 1,
        sourceTotal: sources.length,
        companiesTotal: companies.length,
      });

      let processed = 0;
      let sourceJobCount = 0;

      await mapPool(companies, concurrency, async (company) => {
        if (options.shouldCancel?.() || sourceJobCount >= maxJobsPerSource) {
          return;
        }

        let companyJobs: CreateJobInput[];
        try {
          companyJobs = await sweepCompanyJobs(ats, company, options.fetchImpl);
        } catch (error) {
          sourceErrors.push(
            `${ats}:${company.label}: ${
              error instanceof Error ? error.message : "fetch failed"
            }`,
          );
          processed += 1;
          return;
        }

        let kept = 0;
        for (const job of companyJobs) {
          if (kept >= maxJobsPerCompany || sourceJobCount >= maxJobsPerSource) {
            break;
          }
          if (!matchesSearchTerms(job, searchTerms)) continue;
          if (!matchesLocations(job, locations)) continue;
          const key = job.sourceJobId ?? job.jobUrl;
          if (existingUrls.has(job.jobUrl) || seen.has(key)) continue;
          seen.add(key);
          jobs.push(job);
          kept += 1;
          sourceJobCount += 1;
        }

        processed += 1;
        options.onProgress?.({
          type: "company_done",
          ats,
          sourceIndex: sourceIndex + 1,
          sourceTotal: sources.length,
          companiesProcessed: processed,
          companiesTotal: companies.length,
          jobsCollected: sourceJobCount,
        });
      });

      options.onProgress?.({
        type: "source_complete",
        ats,
        sourceIndex: sourceIndex + 1,
        sourceTotal: sources.length,
        jobsCollected: sourceJobCount,
      });
    }

    return {
      success: true,
      jobs,
      sourceErrors: sourceErrors.length > 0 ? sourceErrors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      jobs,
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while sweeping ATS boards.",
      sourceErrors: sourceErrors.length > 0 ? sourceErrors : undefined,
    };
  }
}
