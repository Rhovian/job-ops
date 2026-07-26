import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AtsId = "greenhouse" | "lever" | "ashby" | "workable";

export const ATS_URL_FIELD: Record<AtsId, string> = {
  greenhouse: "greenhouseUrl",
  lever: "leverUrl",
  ashby: "ashbyUrl",
  workable: "workableUrl",
};

export interface CatalogCompany {
  label: string;
  url: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * The validated company catalogs are the single source of truth shared with the
 * watchlist. They live in the orchestrator config dir; resolve them from a few
 * candidate locations so this works both in-repo and inside the container
 * (where the server runs with cwd=/app/orchestrator).
 */
function candidatePaths(ats: AtsId): string[] {
  const file = `career-boards-${ats}.json`;
  return [
    resolve(moduleDir, "../../..", "orchestrator/src/server/config", file),
    resolve(process.cwd(), "src/server/config", file),
    resolve(process.cwd(), "../orchestrator/src/server/config", file),
  ];
}

export async function readCatalog(ats: AtsId): Promise<CatalogCompany[]> {
  const field = ATS_URL_FIELD[ats];
  for (const path of candidatePaths(ats)) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const companies: CatalogCompany[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const url = typeof record[field] === "string" ? record[field].trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push({ label: label || url, url });
    }
    return companies;
  }
  return [];
}
