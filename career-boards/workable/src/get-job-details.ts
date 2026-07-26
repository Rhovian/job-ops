import {
  buildLocationText,
  fetchWorkableWidget,
  type WorkableJob,
} from "./get-jobs-from-board";
import { htmlToText, optionalString, requiredString } from "./internal";
import { parseWorkableJobUrl } from "./workable-url";

export interface NormalizedWorkableJobDetails {
  source: "workable";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  employmentType?: string;
  isRemote: boolean;
  postedOn?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  raw: WorkableJob;
}

export interface FetchWorkableJobDetailsOptions {
  jobUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export async function getJobDetails(
  options: FetchWorkableJobDetailsOptions,
): Promise<{ job: NormalizedWorkableJobDetails }> {
  const source = parseWorkableJobUrl(options.jobUrl);
  // The widget endpoint returns the whole board; find the posting by shortcode.
  const response = await fetchWorkableWidget({
    source,
    details: true,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    userAgent: options.userAgent,
  });

  const rows = Array.isArray(response.jobs) ? response.jobs : [];
  const job = rows.find((row) => row.shortcode === source.shortcode);
  if (!job) {
    throw new Error(
      `Workable posting ${source.shortcode} was not found on board ${source.canonicalCareersUrl}.`,
    );
  }

  const title = requiredString(
    job.title ?? job.full_title,
    "title",
    source.canonicalJobUrl,
  );
  const jobDescriptionHtml = buildDescriptionHtml(job);

  return {
    job: {
      source: "workable",
      externalId: source.shortcode,
      title,
      jobUrl: optionalString(job.url) ?? source.canonicalJobUrl,
      applyUrl: optionalString(job.application_url),
      locationText: buildLocationText(job.location),
      employmentType: optionalString(job.employment_type),
      isRemote:
        job.telecommuting === true || job.location?.telecommuting === true,
      postedOn: optionalString(job.published_on ?? job.created_at),
      jobDescriptionHtml,
      jobDescriptionText: htmlToText(jobDescriptionHtml),
      raw: job,
    },
  };
}

function buildDescriptionHtml(job: WorkableJob): string {
  const parts: string[] = [];
  if (optionalString(job.description)) parts.push(job.description as string);
  if (optionalString(job.requirements)) {
    parts.push(`<h3>Requirements</h3>${job.requirements}`);
  }
  if (optionalString(job.benefits)) {
    parts.push(`<h3>Benefits</h3>${job.benefits}`);
  }
  return parts.join("\n");
}
