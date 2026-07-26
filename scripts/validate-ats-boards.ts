/**
 * Validate ATS company boards against their live public APIs and write the
 * working ones into the watchlist catalogs.
 *
 * Candidate boards are pulled from the community-maintained, per-ATS company
 * lists in kalil0321/ats-scrapers (CSV: name,slug,url). Each candidate is hit
 * through the SAME helper package the watchlist adapter uses, so "valid" here
 * means exactly what the app will see at runtime. Only boards that currently
 * return at least `--min-jobs` postings are kept; dead/empty/renamed boards are
 * dropped. Results are merged (deduped) into:
 *
 *   orchestrator/src/server/config/career-boards-<ats>.json
 *
 * Usage:
 *   npm run ats:validate                       # 250 candidates/ATS (quick)
 *   npm run ats:validate -- --all              # validate every candidate
 *   npm run ats:validate -- --ats greenhouse,lever --limit 500
 *   npm run ats:validate -- --concurrency 16 --min-jobs 1 --dry-run
 *
 * Flags:
 *   --ats <list>        Comma-separated subset (greenhouse,lever,ashby,workable)
 *   --limit <n>         Max candidates per ATS to test (default 250)
 *   --all               No limit (validate the entire list)
 *   --concurrency <n>   Parallel requests per ATS (default 12)
 *   --min-jobs <n>      Minimum live postings to count as valid (default 1)
 *   --timeout <ms>      Per-request timeout (default 15000)
 *   --dry-run           Report results without writing catalog files
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ashbyUrlToSourceKey } from "../career-boards/ashby/src/ashby-url";
import { getJobsFromBoard as ashbyJobs } from "../career-boards/ashby/src/get-jobs-from-board";
import { getJobsFromBoard as greenhouseJobs } from "../career-boards/greenhouse/src/get-jobs-from-board";
import { greenhouseUrlToSourceKey } from "../career-boards/greenhouse/src/greenhouse-url";
import { getJobsFromBoard as leverJobs } from "../career-boards/lever/src/get-jobs-from-board";
import { leverUrlToSourceKey } from "../career-boards/lever/src/lever-url";
import { getJobsFromBoard as workableJobs } from "../career-boards/workable/src/get-jobs-from-board";
import { workableUrlToSourceKey } from "../career-boards/workable/src/workable-url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(scriptDir, "../orchestrator/src/server/config");
const CSV_BASE =
  "https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies";

interface AtsSpec {
  id: "greenhouse" | "lever" | "ashby" | "workable";
  urlField: string;
  csvUrl: string;
  countJobs: (url: string, signal: AbortSignal) => Promise<number>;
  sourceKey: (url: string) => string;
}

const ATS: AtsSpec[] = [
  {
    id: "greenhouse",
    urlField: "greenhouseUrl",
    csvUrl: `${CSV_BASE}/greenhouse.csv`,
    countJobs: async (url, signal) =>
      (await greenhouseJobs({ careersUrl: url, signal })).total,
    sourceKey: greenhouseUrlToSourceKey,
  },
  {
    id: "lever",
    urlField: "leverUrl",
    csvUrl: `${CSV_BASE}/lever.csv`,
    countJobs: async (url, signal) =>
      (await leverJobs({ careersUrl: url, signal })).total,
    sourceKey: leverUrlToSourceKey,
  },
  {
    id: "ashby",
    urlField: "ashbyUrl",
    csvUrl: `${CSV_BASE}/ashby.csv`,
    countJobs: async (url, signal) =>
      (await ashbyJobs({ careersUrl: url, signal })).total,
    sourceKey: ashbyUrlToSourceKey,
  },
  {
    id: "workable",
    urlField: "workableUrl",
    csvUrl: `${CSV_BASE}/workable.csv`,
    countJobs: async (url, signal) =>
      (await workableJobs({ careersUrl: url, signal })).total,
    sourceKey: workableUrlToSourceKey,
  },
];

interface Candidate {
  name: string;
  url: string;
}

interface Options {
  ats: Set<string>;
  limit: number | null;
  concurrency: number;
  minJobs: number;
  timeoutMs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index !== -1 ? argv[index + 1] : undefined;
  };
  const atsArg = get("--ats");
  return {
    ats: new Set(
      atsArg
        ? atsArg.split(",").map((value) => value.trim())
        : ATS.map((a) => a.id),
    ),
    limit: argv.includes("--all")
      ? null
      : Number.parseInt(get("--limit") ?? "250", 10),
    concurrency: Number.parseInt(get("--concurrency") ?? "12", 10),
    minJobs: Number.parseInt(get("--min-jobs") ?? "1", 10),
    timeoutMs: Number.parseInt(get("--timeout") ?? "15000", 10),
    dryRun: argv.includes("--dry-run"),
  };
}

/** Split one CSV line, honouring RFC-4180 quoted fields and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Parse a `name,slug,url` CSV into candidates (name + authoritative URL). */
function parseCsv(text: string): Candidate[] {
  const rows: Candidate[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 3) continue;
    const name = fields[0].trim();
    const url = fields[fields.length - 1].trim();
    if (!url.startsWith("http")) continue; // skips the header row too
    rows.push({ name: name || url, url });
  }
  return rows;
}

async function fetchCsv(url: string): Promise<Candidate[]> {
  const response = await fetch(url, { headers: { accept: "text/csv" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return parseCsv(await response.text());
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function countWithTimeout(
  spec: AtsSpec,
  url: string,
  timeoutMs: number,
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await spec.countJobs(url, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

interface CatalogEntry {
  label: string;
  [field: string]: string;
}

async function readExistingCatalog(path: string): Promise<CatalogEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as CatalogEntry[]) : [];
  } catch {
    return [];
  }
}

async function validateAts(spec: AtsSpec, options: Options): Promise<void> {
  const allCandidates = await fetchCsv(spec.csvUrl);
  const candidates =
    options.limit === null
      ? allCandidates
      : allCandidates.slice(0, options.limit);

  let valid = 0;
  let emptyOrDead = 0;
  let processed = 0;

  const validatedEntries: CatalogEntry[] = [];
  const seenKeys = new Set<string>();

  await mapPool(candidates, options.concurrency, async (candidate) => {
    processed += 1;
    let count: number;
    try {
      count = await countWithTimeout(spec, candidate.url, options.timeoutMs);
    } catch {
      emptyOrDead += 1;
      return;
    }
    if (count < options.minJobs) {
      emptyOrDead += 1;
      return;
    }
    valid += 1;
    let key: string;
    try {
      key = spec.sourceKey(candidate.url);
    } catch {
      key = candidate.url.toLowerCase();
    }
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    validatedEntries.push({
      label: candidate.name,
      [spec.urlField]: candidate.url,
    });
    if (processed % 50 === 0 || valid % 25 === 0) {
      process.stdout.write(
        `  [${spec.id}] tested ${processed}/${candidates.length}, valid ${valid}\r`,
      );
    }
  });

  // Merge with the existing catalog, keeping existing entries and labels.
  const path = join(CONFIG_DIR, `career-boards-${spec.id}.json`);
  const existing = await readExistingCatalog(path);
  const merged = new Map<string, CatalogEntry>();
  for (const entry of [...existing, ...validatedEntries]) {
    const url = entry[spec.urlField];
    if (!url) continue;
    let key: string;
    try {
      key = spec.sourceKey(url);
    } catch {
      key = url.toLowerCase();
    }
    if (!merged.has(key)) merged.set(key, entry);
  }
  const output = [...merged.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  process.stdout.write(
    `  [${spec.id}] tested ${candidates.length}, valid ${valid}, dead/empty ${emptyOrDead}, catalog ${existing.length} -> ${output.length}\n`,
  );

  if (!options.dryRun) {
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const specs = ATS.filter((spec) => options.ats.has(spec.id));
  if (specs.length === 0) {
    console.error(
      `No matching ATS in --ats. Known: ${ATS.map((a) => a.id).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    `Validating ATS boards (limit ${options.limit ?? "all"}/ATS, concurrency ${options.concurrency}, min-jobs ${options.minJobs}${options.dryRun ? ", dry-run" : ""})`,
  );
  for (const spec of specs) {
    await validateAts(spec, options);
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
