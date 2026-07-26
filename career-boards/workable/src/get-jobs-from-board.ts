import {
  DEFAULT_USER_AGENT,
  fetchWorkableJson,
  optionalString,
  requiredString,
} from "./internal";
import { parseWorkableUrl, type WorkableSourceConfig } from "./workable-url";

export interface WorkableLocation {
  location_str?: string | null;
  country?: string | null;
  country_code?: string | null;
  region?: string | null;
  region_code?: string | null;
  city?: string | null;
  zip_code?: string | null;
  telecommuting?: boolean | null;
}

export interface WorkableJob {
  id?: string | number;
  shortcode?: string;
  title?: string;
  full_title?: string;
  code?: string | null;
  department?: string | null;
  url?: string;
  application_url?: string;
  shortlink?: string;
  employment_type?: string | null;
  telecommuting?: boolean | null;
  created_at?: string | null;
  published_on?: string | null;
  location?: WorkableLocation | null;
  description?: string;
  requirements?: string;
  benefits?: string;
  [key: string]: unknown;
}

export interface WorkableWidgetResponse {
  name?: string;
  description?: string | null;
  jobs?: WorkableJob[];
  [key: string]: unknown;
}

export interface NormalizedWorkableJob {
  source: "workable";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  employmentType?: string;
  isRemote: boolean;
  postedOn?: string;
  raw: WorkableJob;
}

export interface FetchWorkableJobsOptions {
  careersUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export interface FetchWorkableJobsResult {
  /** Company display name from the widget payload, when present. */
  companyName?: string;
  total: number;
  fetched: number;
  jobs: NormalizedWorkableJob[];
}

export async function fetchWorkableWidget(options: {
  source: WorkableSourceConfig;
  details?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}): Promise<WorkableWidgetResponse> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    );
  }

  const url = options.details
    ? `${options.source.widgetApiUrl}?details=true`
    : options.source.widgetApiUrl;

  return fetchWorkableJson<WorkableWidgetResponse>(fetchFn, {
    url,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: options.source.canonicalCareersUrl,
      "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });
}

export async function getJobsFromBoard(
  options: FetchWorkableJobsOptions,
): Promise<FetchWorkableJobsResult> {
  const source = parseWorkableUrl(options.careersUrl);
  const response = await fetchWorkableWidget({
    source,
    details: false,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    userAgent: options.userAgent,
  });

  const rows = Array.isArray(response.jobs) ? response.jobs : [];
  const jobs = rows.map((job) => normalizeWorkableJob(job, source));

  return {
    companyName: optionalString(response.name),
    total: jobs.length,
    fetched: jobs.length,
    jobs,
  };
}

export function normalizeWorkableJob(
  job: WorkableJob,
  source: WorkableSourceConfig,
): NormalizedWorkableJob {
  const shortcode = requiredString(
    job.shortcode,
    "shortcode",
    source.widgetApiUrl,
  );
  const title = requiredString(
    job.title ?? job.full_title,
    "title",
    source.widgetApiUrl,
  );
  const jobUrl =
    optionalString(job.url) ?? `${source.canonicalCareersUrl}/j/${shortcode}`;

  return {
    source: "workable",
    externalId: shortcode,
    title,
    jobUrl,
    applyUrl: optionalString(job.application_url),
    locationText: buildLocationText(job.location),
    employmentType: optionalString(job.employment_type),
    isRemote:
      job.telecommuting === true || job.location?.telecommuting === true,
    postedOn: optionalString(job.published_on ?? job.created_at),
    raw: job,
  };
}

export function buildLocationText(
  location: WorkableLocation | null | undefined,
): string | undefined {
  if (!location) return undefined;
  const explicit = optionalString(location.location_str);
  if (explicit) return explicit;

  const parts = [
    optionalString(location.city),
    optionalString(location.region),
    optionalString(location.country),
  ].filter((value): value is string => Boolean(value));

  if (
    location.telecommuting === true &&
    !parts.some((p) => /remote/i.test(p))
  ) {
    parts.unshift("Remote");
  }

  return parts.length > 0 ? parts.join(", ") : undefined;
}
