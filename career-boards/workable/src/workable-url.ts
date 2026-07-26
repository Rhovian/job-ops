export type WorkableUrlParseErrorCode =
  | "EMPTY_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "MISSING_ACCOUNT"
  | "MISSING_SHORTCODE";

export interface WorkableSourceConfig {
  inputUrl: string;
  /** Account subdomain / slug (e.g. "acme"). */
  account: string;
  /** Public, human-facing board page. */
  canonicalCareersUrl: string;
  /** apply.workable.com widget endpoint. */
  widgetApiUrl: string;
}

export interface WorkableJobSourceConfig extends WorkableSourceConfig {
  shortcode: string;
  canonicalJobUrl: string;
}

export class WorkableUrlParseError extends Error {
  readonly code: WorkableUrlParseErrorCode;
  readonly input: string;

  constructor(code: WorkableUrlParseErrorCode, message: string, input: string) {
    super(message);
    this.name = "WorkableUrlParseError";
    this.code = code;
    this.input = input;
  }
}

const ACCOUNT_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const SHORTCODE_PATTERN = /^[A-Z0-9]{6,}$/i;

export function isWorkableUrl(input: string): boolean {
  try {
    parseWorkableUrl(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Accepts the public Workable board URL shapes, or a bare account slug:
 *
 *   https://apply.workable.com/acme
 *   https://apply.workable.com/api/v1/widget/accounts/acme
 *   https://acme.workable.com
 *   acme
 */
export function parseWorkableUrl(input: string): WorkableSourceConfig {
  if (!input.trim()) {
    throw new WorkableUrlParseError("EMPTY_URL", "URL cannot be empty.", input);
  }
  const account = extractAccount(input);
  return buildSourceConfig(input, account);
}

export function parseWorkableJobUrl(input: string): WorkableJobSourceConfig {
  const source = parseWorkableUrl(input);
  const shortcode = extractShortcode(input);
  if (!shortcode) {
    throw new WorkableUrlParseError(
      "MISSING_SHORTCODE",
      "Workable job URLs must include a job shortcode, for example /j/ABC123DEF.",
      input,
    );
  }
  return buildJobSourceConfig(source, shortcode);
}

export function workableUrlToAccount(input: string): string {
  return parseWorkableUrl(input).account;
}

export function workableUrlToCompanyLabel(input: string): string {
  return formatCompanySlug(parseWorkableUrl(input).account);
}

export function workableUrlToSourceKey(input: string): string {
  return `workable:${toSourceKeyPart(parseWorkableUrl(input).account)}`;
}

function extractAccount(input: string): string {
  const trimmed = input.trim();

  if (!trimmed.includes("/") && !trimmed.includes(".")) {
    return assertAccount(trimmed, input);
  }

  const url = toUrl(trimmed);
  const host = url.hostname.toLowerCase();
  const segments = getPathSegments(url.pathname);

  if (host === "apply.workable.com" || host === "www.workable.com") {
    // Widget API form: /api/v1/widget/accounts/{account}
    const accountsIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === "accounts",
    );
    if (accountsIndex !== -1 && segments[accountsIndex + 1]) {
      return assertAccount(segments[accountsIndex + 1], input);
    }
    // Public board form: /{account}[/j/{shortcode}]
    if (segments[0]) {
      return assertAccount(segments[0], input);
    }
  }

  // Legacy host form: {account}.workable.com
  if (host.endsWith(".workable.com")) {
    const account = host.slice(0, -".workable.com".length);
    if (account && account !== "apply" && account !== "www") {
      return assertAccount(account, input);
    }
  }

  throw new WorkableUrlParseError(
    "UNSUPPORTED_HOST",
    `Unsupported Workable URL: ${input}`,
    input,
  );
}

function extractShortcode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.includes("/")) return null;

  const segments = getPathSegments(toUrl(trimmed).pathname);
  const jIndex = segments.findIndex((segment) => segment.toLowerCase() === "j");
  if (jIndex !== -1 && segments[jIndex + 1]) {
    return segments[jIndex + 1];
  }

  const jobsIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "jobs",
  );
  if (jobsIndex !== -1 && segments[jobsIndex + 1]) {
    return segments[jobsIndex + 1];
  }

  return null;
}

function assertAccount(value: string, input: string): string {
  const account = value.trim();
  if (!ACCOUNT_PATTERN.test(account)) {
    throw new WorkableUrlParseError(
      "MISSING_ACCOUNT",
      `Invalid Workable account slug: ${account}`,
      input,
    );
  }
  return account;
}

function buildSourceConfig(
  inputUrl: string,
  account: string,
): WorkableSourceConfig {
  const encoded = encodeURIComponent(account);
  return {
    inputUrl,
    account,
    canonicalCareersUrl: `https://apply.workable.com/${encoded}`,
    widgetApiUrl: `https://apply.workable.com/api/v1/widget/accounts/${encoded}`,
  };
}

function buildJobSourceConfig(
  source: WorkableSourceConfig,
  shortcode: string,
): WorkableJobSourceConfig {
  if (!SHORTCODE_PATTERN.test(shortcode)) {
    throw new WorkableUrlParseError(
      "MISSING_SHORTCODE",
      `Invalid Workable shortcode: ${shortcode}`,
      source.inputUrl,
    );
  }
  return {
    ...source,
    shortcode,
    canonicalJobUrl: `${source.canonicalCareersUrl}/j/${shortcode}`,
  };
}

function toUrl(input: string): URL {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new WorkableUrlParseError(
      "INVALID_URL",
      `Invalid URL: ${input}`,
      input,
    );
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
