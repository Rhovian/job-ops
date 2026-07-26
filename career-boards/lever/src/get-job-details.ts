import {
  buildLocationText,
  type LeverList,
  type LeverPosting,
} from "./get-jobs-from-board";
import {
  DEFAULT_USER_AGENT,
  epochMsToIso,
  fetchLeverJson,
  htmlToText,
  optionalString,
  requiredString,
} from "./internal";
import { parseLeverJobUrl } from "./lever-url";

export interface NormalizedLeverJobDetails {
  source: "lever";
  externalId: string;
  title: string;
  jobUrl: string;
  applyUrl?: string;
  locationText?: string;
  commitment?: string;
  workplaceType?: string;
  postedOn?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  raw: LeverPosting;
}

export interface FetchLeverJobDetailsOptions {
  jobUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export async function getJobDetails(
  options: FetchLeverJobDetailsOptions,
): Promise<{ job: NormalizedLeverJobDetails }> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    );
  }

  const source = parseLeverJobUrl(options.jobUrl);
  const posting = await fetchLeverJson<LeverPosting>(fetchFn, {
    url: source.jobApiUrl,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: source.canonicalJobUrl,
      "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  const title = requiredString(posting.text, "text", source.canonicalJobUrl);
  const jobDescriptionHtml = buildDescriptionHtml(posting);

  return {
    job: {
      source: "lever",
      externalId: source.jobId,
      title,
      jobUrl: optionalString(posting.hostedUrl) ?? source.canonicalJobUrl,
      applyUrl: optionalString(posting.applyUrl),
      locationText: buildLocationText(posting.categories),
      commitment: optionalString(posting.categories?.commitment),
      workplaceType: optionalString(posting.workplaceType),
      postedOn: epochMsToIso(posting.createdAt),
      jobDescriptionHtml,
      jobDescriptionText:
        optionalString(posting.descriptionPlain) ??
        htmlToText(jobDescriptionHtml),
      raw: posting,
    },
  };
}

function buildDescriptionHtml(posting: LeverPosting): string {
  const parts: string[] = [];
  if (optionalString(posting.description)) {
    parts.push(posting.description as string);
  }
  for (const list of asLists(posting.lists)) {
    const heading = optionalString(list.text);
    const content = optionalString(list.content);
    if (!heading && !content) continue;
    parts.push(
      `${heading ? `<h3>${heading}</h3>` : ""}${content ? `<ul>${content}</ul>` : ""}`,
    );
  }
  if (optionalString(posting.additional)) {
    parts.push(posting.additional as string);
  }
  return parts.join("\n");
}

function asLists(value: unknown): LeverList[] {
  return Array.isArray(value) ? (value as LeverList[]) : [];
}
