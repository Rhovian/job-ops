import type { CreateJobInput } from "@shared/types/jobs";
import {
  toNumberOrNull,
  toStringOrNull,
} from "@shared/utils/type-conversion.js";
import {
  createLaunchOptions,
  getCloudflareCookieStorageDir,
  invalidateCookies,
  isChallengePage,
  loadCookies,
  readCookieJar,
  saveCookies,
  waitForChallengeResolution,
} from "browser-utils";
import { type Browser, firefox, type Page } from "playwright";

const EXTRACTOR_ID = "wellfound";
const BASE_URL = "https://wellfound.com";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const NAVIGATION_TIMEOUT_MS = 60_000;
const SETTLE_TIMEOUT_MS = 8_000;
const MAX_SCROLLS = 6;
const SCROLL_DELAY_MS = 1_200;

export type WellfoundProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
      pageNo: number;
      totalCollected: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
      jobsFoundTerm: number;
    };

export interface RunWellfoundOptions {
  searchTerms?: string[];
  locations?: string[];
  existingJobUrls?: string[];
  maxJobsPerTerm?: number;
  remoteOnly?: boolean;
  onProgress?: (event: WellfoundProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface WellfoundResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
  challengeRequired?: string;
}

export function slugifyKeyword(keyword: string): string {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds a Wellfound role listing URL. Wellfound exposes server-rendered role
 * pages that are the most scrape-friendly entry points:
 *
 *   https://wellfound.com/role/<role>                       (role)
 *   https://wellfound.com/role/l/<role>/<location>          (role + location)
 *   https://wellfound.com/role/r/<role>                     (remote role)
 */
export function makeWellfoundSearchUrl(args: {
  keyword: string;
  location?: string | null;
  remoteOnly?: boolean;
}): string {
  const roleSlug = slugifyKeyword(args.keyword) || "software-engineer";
  const location = args.location?.trim();
  if (location) {
    return `${BASE_URL}/role/l/${roleSlug}/${slugifyKeyword(location)}`;
  }
  if (args.remoteOnly) {
    return `${BASE_URL}/role/r/${roleSlug}`;
  }
  return `${BASE_URL}/role/${roleSlug}`;
}

export function resolveWellfoundMaxJobsPerTerm(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_JOBS_PER_TERM;
  return Math.max(1, Math.floor(parsed));
}

export interface WellfoundJobNode {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  url?: unknown;
  canonicalUrl?: unknown;
  remote?: unknown;
  locationNames?: unknown;
  location?: unknown;
  compensation?: unknown;
  salary?: unknown;
  liveStartAt?: unknown;
  createdAt?: unknown;
  publishedAt?: unknown;
  startup?: WellfoundCompanyNode;
  company?: WellfoundCompanyNode;
  organization?: WellfoundCompanyNode;
  [key: string]: unknown;
}

interface WellfoundCompanyNode {
  name?: unknown;
  slug?: unknown;
  companyUrl?: unknown;
  [key: string]: unknown;
}

function getCompanyNode(node: WellfoundJobNode): WellfoundCompanyNode | null {
  const candidate = node.startup ?? node.company ?? node.organization;
  return candidate && typeof candidate === "object"
    ? (candidate as WellfoundCompanyNode)
    : null;
}

function looksLikeJobNode(value: unknown): value is WellfoundJobNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as WellfoundJobNode;
  if (!toStringOrNull(node.title)) return false;
  if (toStringOrNull(node.id) === null && toStringOrNull(node.slug) === null) {
    return false;
  }
  return getCompanyNode(node) !== null;
}

/**
 * Wellfound is a Next.js/Apollo app whose listing payloads vary by route and
 * release. Rather than couple to one GraphQL query shape, deep-walk any JSON
 * blob (the embedded __NEXT_DATA__ document or a captured /graphql response)
 * and collect every object that structurally looks like a job listing.
 */
export function collectJobNodes(value: unknown): WellfoundJobNode[] {
  const out: WellfoundJobNode[] = [];
  const seen = new Set<unknown>();

  const walk = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }

    if (looksLikeJobNode(current)) {
      out.push(current as WellfoundJobNode);
    }
    for (const item of Object.values(current as Record<string, unknown>)) {
      walk(item);
    }
  };

  walk(value);
  return out;
}

export function extractNextData(html: string): unknown | null {
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function buildJobUrl(id: string | null, slug: string | null): string | null {
  if (id) {
    return slug ? `${BASE_URL}/jobs/${id}-${slug}` : `${BASE_URL}/jobs/${id}`;
  }
  if (slug) return `${BASE_URL}/jobs/${slug}`;
  return null;
}

function buildLocation(node: WellfoundJobNode): string | undefined {
  const names = Array.isArray(node.locationNames)
    ? node.locationNames
        .map((value) => toStringOrNull(value))
        .filter((value): value is string => Boolean(value))
    : [];
  if (names.length > 0) return names.join(", ");
  const single = toStringOrNull(node.location);
  if (single) return single;
  if (node.remote === true) return "Remote";
  return undefined;
}

function parseDatePosted(value: unknown): string | undefined {
  const numeric = toNumberOrNull(value);
  if (numeric !== null) {
    // Wellfound timestamps are usually epoch seconds.
    const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const text = toStringOrNull(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function mapWellfoundJob(node: WellfoundJobNode): CreateJobInput | null {
  const id = toStringOrNull(node.id);
  const slug = toStringOrNull(node.slug);
  const jobUrl =
    toStringOrNull(node.url) ??
    toStringOrNull(node.canonicalUrl) ??
    buildJobUrl(id, slug);
  if (!jobUrl) return null;

  const title = toStringOrNull(node.title);
  if (!title) return null;

  const company = getCompanyNode(node);
  const companySlug = toStringOrNull(company?.slug);

  return {
    source: "wellfound",
    sourceJobId: id ?? slug ?? undefined,
    title,
    employer: toStringOrNull(company?.name) ?? "Unknown Employer",
    employerUrl:
      toStringOrNull(company?.companyUrl) ??
      (companySlug ? `${BASE_URL}/company/${companySlug}` : undefined),
    jobUrl,
    applicationLink: jobUrl,
    location: buildLocation(node),
    salary:
      toStringOrNull(node.compensation) ??
      toStringOrNull(node.salary) ??
      undefined,
    datePosted: parseDatePosted(
      node.liveStartAt ?? node.publishedAt ?? node.createdAt,
    ),
    isRemote: node.remote === true ? true : undefined,
  };
}

export function dedupeWellfoundJobs(
  jobs: CreateJobInput[],
  existingJobUrls: string[] = [],
): CreateJobInput[] {
  const existingUrls = new Set(existingJobUrls);
  const seen = new Set<string>();
  const deduped: CreateJobInput[] = [];

  for (const job of jobs) {
    if (existingUrls.has(job.jobUrl)) continue;
    const key = job.sourceJobId ?? job.jobUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }

  return deduped;
}

function resolveRunLocations(
  locations: string[] | undefined,
): Array<string | null> {
  const normalized = (locations ?? [])
    .map((location) => location.trim())
    .filter(Boolean);
  return normalized.length === 0 ? [null] : normalized;
}

async function assertNoBlockingChallenge(
  page: Page,
  url: string,
): Promise<string | null> {
  if (await isChallengePage(page)) {
    const challenge = await waitForChallengeResolution(page, 30_000);
    if (challenge.status === "passed") {
      await saveCookies(page.context(), EXTRACTOR_ID);
      return null;
    }
    await invalidateCookies(EXTRACTOR_ID);
    return url;
  }
  return null;
}

async function launchBrowser(): Promise<{
  browser: Browser;
  userAgent?: string;
}> {
  const storageDir = getCloudflareCookieStorageDir();
  const cookieJar = await readCookieJar(EXTRACTOR_ID, storageDir);
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  return { browser, userAgent: cookieJar.userAgent };
}

async function collectForTerm(params: {
  browser: Browser;
  userAgent?: string;
  searchTerm: string;
  location: string | null;
  remoteOnly: boolean;
  maxJobsPerTerm: number;
  onPage: (pageNo: number, total: number) => void;
  shouldCancel?: () => boolean;
}): Promise<{ jobs: CreateJobInput[]; challengeRequired?: string }> {
  const searchUrl = makeWellfoundSearchUrl({
    keyword: params.searchTerm,
    location: params.location,
    remoteOnly: params.remoteOnly,
  });
  const storageDir = getCloudflareCookieStorageDir();
  const context = await params.browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(params.userAgent ? { userAgent: params.userAgent } : {}),
  });
  await loadCookies(context, EXTRACTOR_ID, storageDir);
  const page = await context.newPage();

  // Capture GraphQL payloads as the SPA fetches additional pages.
  const graphqlBodies: string[] = [];
  page.on("response", (response) => {
    if (!response.url().includes("/graphql")) return;
    if (!response.ok()) return;
    response
      .text()
      .then((text) => {
        graphqlBodies.push(text);
      })
      .catch(() => {});
  });

  const collected = new Map<string, CreateJobInput>();

  const ingest = (raw: unknown): void => {
    for (const node of collectJobNodes(raw)) {
      const mapped = mapWellfoundJob(node);
      if (!mapped) continue;
      const key = mapped.sourceJobId ?? mapped.jobUrl;
      if (!collected.has(key)) collected.set(key, mapped);
    }
  };

  try {
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const challenge = await assertNoBlockingChallenge(page, searchUrl);
    if (challenge) {
      return { jobs: [], challengeRequired: challenge };
    }

    // Initial payload is embedded in the server-rendered document.
    ingest(extractNextData(await page.content()));
    params.onPage(1, collected.size);

    await page
      .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});

    for (
      let scroll = 0;
      scroll < MAX_SCROLLS && collected.size < params.maxJobsPerTerm;
      scroll += 1
    ) {
      if (params.shouldCancel?.()) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_DELAY_MS);

      while (graphqlBodies.length > 0) {
        const body = graphqlBodies.shift();
        if (!body) continue;
        try {
          ingest(JSON.parse(body));
        } catch {
          // Ignore non-JSON bodies.
        }
      }
      params.onPage(scroll + 2, collected.size);
    }

    // Drain any remaining captured payloads.
    for (const body of graphqlBodies) {
      try {
        ingest(JSON.parse(body));
      } catch {
        // Ignore.
      }
    }

    return { jobs: [...collected.values()].slice(0, params.maxJobsPerTerm) };
  } finally {
    await context.close();
  }
}

export async function runWellfound(
  options: RunWellfoundOptions = {},
): Promise<WellfoundResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["software engineer"];
  const runLocations = resolveRunLocations(options.locations);
  const maxJobsPerTerm = resolveWellfoundMaxJobsPerTerm(options.maxJobsPerTerm);
  const remoteOnly = options.remoteOnly ?? false;
  const termTotal = searchTerms.length * runLocations.length;
  const allJobs: CreateJobInput[] = [];
  let runIndex = 0;
  let browser: Browser | undefined;
  let userAgent: string | undefined;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    userAgent = launched.userAgent;

    for (const location of runLocations) {
      for (const searchTerm of searchTerms) {
        runIndex += 1;
        if (options.shouldCancel?.()) {
          return {
            success: true,
            jobs: dedupeWellfoundJobs(allJobs, options.existingJobUrls),
          };
        }

        options.onProgress?.({
          type: "term_start",
          termIndex: runIndex,
          termTotal,
          searchTerm,
          location: location ?? undefined,
        });

        const result = await collectForTerm({
          browser,
          userAgent,
          searchTerm,
          location,
          remoteOnly,
          maxJobsPerTerm,
          shouldCancel: options.shouldCancel,
          onPage: (pageNo, totalCollected) => {
            options.onProgress?.({
              type: "page_fetched",
              termIndex: runIndex,
              termTotal,
              searchTerm,
              location: location ?? undefined,
              pageNo,
              totalCollected,
            });
          },
        });

        if (result.challengeRequired) {
          return {
            success: false,
            jobs: [],
            challengeRequired: result.challengeRequired,
          };
        }

        allJobs.push(...result.jobs);
        options.onProgress?.({
          type: "term_complete",
          termIndex: runIndex,
          termTotal,
          searchTerm,
          location: location ?? undefined,
          jobsFoundTerm: result.jobs.length,
        });
      }
    }

    return {
      success: true,
      jobs: dedupeWellfoundJobs(allJobs, options.existingJobUrls),
    };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error:
        error instanceof Error
          ? error.message
          : "Unexpected error while running Wellfound extractor.",
    };
  } finally {
    await browser?.close();
  }
}
