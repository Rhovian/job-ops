export type LeverUrlParseErrorCode =
  | "EMPTY_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "MISSING_COMPANY"
  | "INVALID_JOB_ID";

export interface LeverSourceConfig {
  inputUrl: string;
  company: string;
  /** Public, human-facing board page. */
  canonicalCareersUrl: string;
  /** api.lever.co postings endpoint (mode=json). */
  postingsApiUrl: string;
}

export interface LeverJobSourceConfig extends LeverSourceConfig {
  jobId: string;
  canonicalJobUrl: string;
  jobApiUrl: string;
}

export class LeverUrlParseError extends Error {
  readonly code: LeverUrlParseErrorCode;
  readonly input: string;

  constructor(code: LeverUrlParseErrorCode, message: string, input: string) {
    super(message);
    this.name = "LeverUrlParseError";
    this.code = code;
    this.input = input;
  }
}

const LEVER_HOSTS = ["jobs.lever.co", "api.lever.co"];
const COMPANY_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
// Lever job ids are UUIDs.
const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeverUrl(input: string): boolean {
  try {
    parseLeverUrl(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Accepts any of the public Lever board URL shapes, or a bare company slug:
 *
 *   https://jobs.lever.co/acme
 *   https://api.lever.co/v0/postings/acme
 *   acme
 */
export function parseLeverUrl(input: string): LeverSourceConfig {
  if (!input.trim()) {
    throw new LeverUrlParseError("EMPTY_URL", "URL cannot be empty.", input);
  }
  const company = extractCompany(input);
  return buildSourceConfig(input, company);
}

export function parseLeverJobUrl(input: string): LeverJobSourceConfig {
  const source = parseLeverUrl(input);
  const jobId = extractJobId(input);
  if (!jobId) {
    throw new LeverUrlParseError(
      "INVALID_JOB_ID",
      "Lever job URLs must include a posting id (UUID).",
      input,
    );
  }
  return buildJobSourceConfig(source, jobId);
}

export function leverUrlToCompany(input: string): string {
  return parseLeverUrl(input).company;
}

export function leverUrlToCompanyLabel(input: string): string {
  return formatCompanySlug(parseLeverUrl(input).company);
}

export function leverUrlToSourceKey(input: string): string {
  return `lever:${toSourceKeyPart(parseLeverUrl(input).company)}`;
}

function extractCompany(input: string): string {
  const trimmed = input.trim();

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return assertCompany(trimmed, input);
  }

  const url = toUrl(trimmed);
  const host = url.hostname.toLowerCase();
  if (!LEVER_HOSTS.includes(host)) {
    throw new LeverUrlParseError(
      "UNSUPPORTED_HOST",
      `Unsupported Lever host: ${host}`,
      input,
    );
  }

  const segments = getPathSegments(url.pathname);

  // API form: /v0/postings/{company}[/{id}]
  const postingsIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "postings",
  );
  if (postingsIndex !== -1 && segments[postingsIndex + 1]) {
    return assertCompany(segments[postingsIndex + 1], input);
  }

  // Public board form: /{company}[/{id}]
  if (segments[0]) {
    return assertCompany(segments[0], input);
  }

  throw new LeverUrlParseError(
    "MISSING_COMPANY",
    "Lever URLs must include a company slug, for example /acme.",
    input,
  );
}

function extractJobId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.includes("/")) return null;

  const segments = getPathSegments(toUrl(trimmed).pathname);
  const candidate = segments.find((segment) => JOB_ID_PATTERN.test(segment));
  return candidate ?? null;
}

function assertCompany(value: string, input: string): string {
  const company = value.trim();
  if (!COMPANY_PATTERN.test(company)) {
    throw new LeverUrlParseError(
      "MISSING_COMPANY",
      `Invalid Lever company slug: ${company}`,
      input,
    );
  }
  return company;
}

function buildSourceConfig(
  inputUrl: string,
  company: string,
): LeverSourceConfig {
  const encoded = encodeURIComponent(company);
  return {
    inputUrl,
    company,
    canonicalCareersUrl: `https://jobs.lever.co/${encoded}`,
    postingsApiUrl: `https://api.lever.co/v0/postings/${encoded}?mode=json`,
  };
}

function buildJobSourceConfig(
  source: LeverSourceConfig,
  jobId: string,
): LeverJobSourceConfig {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new LeverUrlParseError(
      "INVALID_JOB_ID",
      `Invalid Lever posting id: ${jobId}`,
      source.inputUrl,
    );
  }
  const encodedCompany = encodeURIComponent(source.company);
  return {
    ...source,
    jobId,
    canonicalJobUrl: `${source.canonicalCareersUrl}/${jobId}`,
    jobApiUrl: `https://api.lever.co/v0/postings/${encodedCompany}/${jobId}?mode=json`,
  };
}

function toUrl(input: string): URL {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new LeverUrlParseError("INVALID_URL", `Invalid URL: ${input}`, input);
  }
}

function getPathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function formatCompanySlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSourceKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
