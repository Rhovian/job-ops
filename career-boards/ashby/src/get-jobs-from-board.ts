import { type AshbySourceConfig, parseAshbyUrl } from "./ashby-url";
import {
  DEFAULT_USER_AGENT,
  fetchAshbyJson,
  optionalString,
  requiredString,
} from "./internal";

export interface AshbyCompensation {
  compensationTierSummary?: string | null;
  scrapeableCompensationSalarySummary?: string | null;
}

export interface AshbyJob {
  id?: string;
  title?: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  publishedAt?: string | null;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: AshbyCompensation | null;
  [key: string]: unknown;
}

export interface AshbyBoardResponse {
  jobs?: AshbyJob[];
  [key: string]: unknown;
}

export interface NormalizedAshbyJob {
  source: "ashby";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  employmentType?: string;
  workplaceType?: string;
  salary?: string;
  postedOn?: string;
  raw: AshbyJob;
}

export interface FetchAshbyJobsOptions {
  careersUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export interface FetchAshbyJobsResult {
  total: number;
  fetched: number;
  jobs: NormalizedAshbyJob[];
}

export async function fetchAshbyBoard(options: {
  source: AshbySourceConfig;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}): Promise<AshbyJob[]> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    );
  }

  const response = await fetchAshbyJson<AshbyBoardResponse>(fetchFn, {
    url: options.source.boardApiUrl,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: options.source.canonicalCareersUrl,
      "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  return Array.isArray(response.jobs) ? response.jobs : [];
}

export async function getJobsFromBoard(
  options: FetchAshbyJobsOptions,
): Promise<FetchAshbyJobsResult> {
  const source = parseAshbyUrl(options.careersUrl);
  const rows = await fetchAshbyBoard({
    source,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    userAgent: options.userAgent,
  });
  const jobs = rows.map((job) => normalizeAshbyJob(job, source));

  return {
    total: jobs.length,
    fetched: jobs.length,
    jobs,
  };
}

export function normalizeAshbyJob(
  job: AshbyJob,
  source: AshbySourceConfig,
): NormalizedAshbyJob {
  const externalId = requiredString(job.id, "id", source.boardApiUrl);
  const title = requiredString(job.title, "title", source.boardApiUrl);
  const jobUrl =
    optionalString(job.jobUrl) ?? `${source.canonicalCareersUrl}/${externalId}`;

  return {
    source: "ashby",
    externalId,
    title,
    jobUrl,
    applyUrl: optionalString(job.applyUrl),
    locationText: buildLocationText(job),
    employmentType: optionalString(job.employmentType),
    workplaceType: optionalString(job.workplaceType),
    salary: optionalString(job.compensation?.compensationTierSummary),
    postedOn: optionalString(job.publishedAt),
    raw: job,
  };
}

export function buildLocationText(job: AshbyJob): string | undefined {
  const base = optionalString(job.location);
  if (job.isRemote === true) {
    if (!base) return "Remote";
    if (!/remote/i.test(base)) return `Remote · ${base}`;
  }
  return base;
}
