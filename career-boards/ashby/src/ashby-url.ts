export type AshbyUrlParseErrorCode =
  | "EMPTY_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "MISSING_ORG"
  | "INVALID_JOB_ID";

export interface AshbySourceConfig {
  inputUrl: string;
  /** Organisation slug, case-sensitive (e.g. "Ramp"). */
  org: string;
  /** Public, human-facing board page. */
  canonicalCareersUrl: string;
  /** api.ashbyhq.com posting-api board endpoint. */
  boardApiUrl: string;
}

export interface AshbyJobSourceConfig extends AshbySourceConfig {
  jobId: string;
  canonicalJobUrl: string;
}

export class AshbyUrlParseError extends Error {
  readonly code: AshbyUrlParseErrorCode;
  readonly input: string;

  constructor(code: AshbyUrlParseErrorCode, message: string, input: string) {
    super(message);
    this.name = "AshbyUrlParseError";
    this.code = code;
    this.input = input;
  }
}

const ASHBY_HOSTS = ["jobs.ashbyhq.com", "api.ashbyhq.com"];
const ORG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAshbyUrl(input: string): boolean {
  try {
    parseAshbyUrl(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Accepts any of the public Ashby board URL shapes, or a bare org slug:
 *
 *   https://jobs.ashbyhq.com/Ramp
 *   https://api.ashbyhq.com/posting-api/job-board/Ramp
 *   Ramp
 */
export function parseAshbyUrl(input: string): AshbySourceConfig {
  if (!input.trim()) {
    throw new AshbyUrlParseError("EMPTY_URL", "URL cannot be empty.", input);
  }
  const org = extractOrg(input);
  return buildSourceConfig(input, org);
}

export function parseAshbyJobUrl(input: string): AshbyJobSourceConfig {
  const source = parseAshbyUrl(input);
  const jobId = extractJobId(input);
  if (!jobId) {
    throw new AshbyUrlParseError(
      "INVALID_JOB_ID",
      "Ashby job URLs must include a posting id (UUID).",
      input,
    );
  }
  return buildJobSourceConfig(source, jobId);
}

export function ashbyUrlToOrg(input: string): string {
  return parseAshbyUrl(input).org;
}

export function ashbyUrlToCompanyLabel(input: string): string {
  return formatCompanySlug(parseAshbyUrl(input).org);
}

export function ashbyUrlToSourceKey(input: string): string {
  return `ashby:${toSourceKeyPart(parseAshbyUrl(input).org)}`;
}

function extractOrg(input: string): string {
  const trimmed = input.trim();

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return assertOrg(trimmed, input);
  }

  const url = toUrl(trimmed);
  const host = url.hostname.toLowerCase();
  if (!ASHBY_HOSTS.includes(host)) {
    throw new AshbyUrlParseError(
      "UNSUPPORTED_HOST",
      `Unsupported Ashby host: ${host}`,
      input,
    );
  }

  const segments = getPathSegments(url.pathname);

  // API form: /posting-api/job-board/{org}
  const boardIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "job-board",
  );
  if (boardIndex !== -1 && segments[boardIndex + 1]) {
    return assertOrg(segments[boardIndex + 1], input);
  }

  // Public board form: /{org}[/{id}]
  if (segments[0]) {
    return assertOrg(segments[0], input);
  }

  throw new AshbyUrlParseError(
    "MISSING_ORG",
    "Ashby URLs must include an organisation slug, for example /Ramp.",
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

function assertOrg(value: string, input: string): string {
  const org = value.trim();
  if (!ORG_PATTERN.test(org)) {
    throw new AshbyUrlParseError(
      "MISSING_ORG",
      `Invalid Ashby organisation slug: ${org}`,
      input,
    );
  }
  return org;
}

function buildSourceConfig(inputUrl: string, org: string): AshbySourceConfig {
  const encoded = encodeURIComponent(org);
  return {
    inputUrl,
    org,
    canonicalCareersUrl: `https://jobs.ashbyhq.com/${encoded}`,
    boardApiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encoded}?includeCompensation=true`,
  };
}

function buildJobSourceConfig(
  source: AshbySourceConfig,
  jobId: string,
): AshbyJobSourceConfig {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new AshbyUrlParseError(
      "INVALID_JOB_ID",
      `Invalid Ashby posting id: ${jobId}`,
      source.inputUrl,
    );
  }
  return {
    ...source,
    jobId,
    canonicalJobUrl: `${source.canonicalCareersUrl}/${jobId}`,
  };
}

function toUrl(input: string): URL {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new AshbyUrlParseError("INVALID_URL", `Invalid URL: ${input}`, input);
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
  // Ashby org slugs are often already PascalCase (e.g. "Ramp"); only split
  // on explicit separators.
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
