import { resolveSearchCities } from "job-ops-shared/search-cities";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "job-ops-shared/types/extractors";
import { type AtsBoardsProgressEvent, isAtsId, runAtsBoards } from "./src/run";

const ATS_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
};

function toProgress(event: AtsBoardsProgressEvent): ExtractorProgressEvent {
  const label = ATS_LABELS[event.ats] ?? event.ats;

  if (event.type === "source_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.sourceIndex - 1, 0),
      termsTotal: event.sourceTotal,
      currentUrl: event.ats,
      detail: `${label}: sweeping ${event.companiesTotal} boards`,
    };
  }

  if (event.type === "company_done") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.sourceIndex - 1, 0),
      termsTotal: event.sourceTotal,
      listPagesProcessed: event.companiesProcessed,
      listPagesTotal: event.companiesTotal,
      jobPagesEnqueued: event.jobsCollected,
      jobPagesProcessed: event.jobsCollected,
      currentUrl: event.ats,
      detail: `${label}: ${event.companiesProcessed}/${event.companiesTotal} boards (${event.jobsCollected} matched)`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.sourceIndex,
    termsTotal: event.sourceTotal,
    currentUrl: event.ats,
    detail: `${label}: done — ${event.jobsCollected} matched`,
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const manifest: ExtractorManifest = {
  id: "atsboards",
  displayName: "ATS Boards",
  providesSources: ["greenhouse", "lever", "ashby", "workable"],
  locationCapabilities: {
    greenhouse: { supportedCountryKeys: null },
    lever: { supportedCountryKeys: null },
    ashby: { supportedCountryKeys: null },
    workable: { supportedCountryKeys: null },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const sources = context.selectedSources.filter(isAtsId);
    if (sources.length === 0) {
      return { success: true, jobs: [] };
    }

    const existingJobUrls = await context.getExistingJobUrls?.();

    const result = await runAtsBoards({
      sources,
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        list: context.sourceLocationPlan?.requestedCities,
        single:
          context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      maxCompaniesPerSource: parsePositiveInt(
        context.settings.atsboardsMaxCompanies,
      ),
      concurrency: parsePositiveInt(context.settings.atsboardsConcurrency),
      maxJobsPerCompany: parsePositiveInt(
        context.settings.atsboardsMaxJobsPerCompany,
      ),
      maxJobsPerSource: parsePositiveInt(
        context.settings.atsboardsMaxJobsPerSource,
      ),
      existingJobUrls,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
        sourceErrors: result.sourceErrors,
      };
    }

    return {
      success: true,
      jobs: result.jobs,
      sourceErrors: result.sourceErrors,
    };
  },
};

export default manifest;
