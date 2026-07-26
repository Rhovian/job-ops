import { parseAshbyJobUrl } from "./ashby-url";
import {
  type AshbyJob,
  buildLocationText,
  fetchAshbyBoard,
} from "./get-jobs-from-board";
import { htmlToText, optionalString, requiredString } from "./internal";

export interface NormalizedAshbyJobDetails {
  source: "ashby";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  employmentType?: string;
  salary?: string;
  postedOn?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  raw: AshbyJob;
}

export interface FetchAshbyJobDetailsOptions {
  jobUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export async function getJobDetails(
  options: FetchAshbyJobDetailsOptions,
): Promise<{ job: NormalizedAshbyJobDetails }> {
  const source = parseAshbyJobUrl(options.jobUrl);
  // Ashby's posting API only exposes the whole board; find the posting by id.
  const rows = await fetchAshbyBoard({
    source,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    userAgent: options.userAgent,
  });

  const job = rows.find((row) => row.id === source.jobId);
  if (!job) {
    throw new Error(
      `Ashby posting ${source.jobId} was not found on board ${source.canonicalCareersUrl}.`,
    );
  }

  const title = requiredString(job.title, "title", source.canonicalJobUrl);
  const descriptionHtml =
    optionalString(job.descriptionHtml) ??
    (optionalString(job.descriptionPlain)
      ? `<p>${job.descriptionPlain}</p>`
      : "");

  return {
    job: {
      source: "ashby",
      externalId: source.jobId,
      title,
      jobUrl: optionalString(job.jobUrl) ?? source.canonicalJobUrl,
      applyUrl: optionalString(job.applyUrl),
      locationText: buildLocationText(job),
      employmentType: optionalString(job.employmentType),
      salary: optionalString(job.compensation?.compensationTierSummary),
      postedOn: optionalString(job.publishedAt),
      jobDescriptionHtml: descriptionHtml,
      jobDescriptionText:
        optionalString(job.descriptionPlain) ?? htmlToText(descriptionHtml),
      raw: job,
    },
  };
}
