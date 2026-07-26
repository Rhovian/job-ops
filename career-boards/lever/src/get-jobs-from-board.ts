import {
  DEFAULT_USER_AGENT,
  epochMsToIso,
  fetchLeverJson,
  optionalString,
  requiredString,
} from "./internal";
import { type LeverSourceConfig, parseLeverUrl } from "./lever-url";

export interface LeverCategories {
  commitment?: string | null;
  department?: string | null;
  location?: string | null;
  team?: string | null;
  allLocations?: string[] | null;
}

export interface LeverList {
  text?: string;
  content?: string;
}

export interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: LeverCategories | null;
  createdAt?: number;
  country?: string | null;
  workplaceType?: string | null;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
  additionalPlain?: string;
  lists?: LeverList[];
  [key: string]: unknown;
}

export interface NormalizedLeverJob {
  source: "lever";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  commitment?: string;
  workplaceType?: string;
  postedOn?: string;
  raw: LeverPosting;
}

export interface FetchLeverJobsOptions {
  careersUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export interface FetchLeverJobsResult {
  total: number;
  fetched: number;
  jobs: NormalizedLeverJob[];
}

export async function getJobsFromBoard(
  options: FetchLeverJobsOptions,
): Promise<FetchLeverJobsResult> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    );
  }

  const source = parseLeverUrl(options.careersUrl);
  const response = await fetchLeverJson<LeverPosting[]>(fetchFn, {
    url: source.postingsApiUrl,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: source.canonicalCareersUrl,
      "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  if (!Array.isArray(response)) {
    throw new Error(
      `Lever response was not an array for ${source.postingsApiUrl} (unknown company?).`,
    );
  }

  const jobs = response.map((posting) =>
    normalizeLeverPosting(posting, source),
  );

  return {
    total: jobs.length,
    fetched: jobs.length,
    jobs,
  };
}

export function buildLocationText(
  categories: LeverCategories | null | undefined,
): string | undefined {
  if (!categories) return undefined;
  const all = Array.isArray(categories.allLocations)
    ? categories.allLocations
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  if (all.length > 0) return all.join(" / ");
  return optionalString(categories.location);
}

export function normalizeLeverPosting(
  posting: LeverPosting,
  source: LeverSourceConfig,
): NormalizedLeverJob {
  const externalId = requiredString(posting.id, "id", source.postingsApiUrl);
  const title = requiredString(posting.text, "text", source.postingsApiUrl);
  const jobUrl =
    optionalString(posting.hostedUrl) ??
    `${source.canonicalCareersUrl}/${externalId}`;

  return {
    source: "lever",
    externalId,
    title,
    jobUrl,
    applyUrl: optionalString(posting.applyUrl),
    locationText: buildLocationText(posting.categories),
    commitment: optionalString(posting.categories?.commitment),
    workplaceType: optionalString(posting.workplaceType),
    postedOn: epochMsToIso(posting.createdAt),
    raw: posting,
  };
}
