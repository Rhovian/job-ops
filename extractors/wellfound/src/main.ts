import { runWellfound } from "./run.js";

const result = await runWellfound({
  searchTerms: process.env.WELLFOUND_SEARCH_TERMS
    ? JSON.parse(process.env.WELLFOUND_SEARCH_TERMS)
    : undefined,
  maxJobsPerTerm: process.env.WELLFOUND_MAX_JOBS_PER_TERM
    ? Number.parseInt(process.env.WELLFOUND_MAX_JOBS_PER_TERM, 10)
    : undefined,
});

if (!result.success) {
  console.error(
    result.challengeRequired
      ? `Wellfound requires a manual challenge: ${result.challengeRequired}`
      : (result.error ?? "Wellfound extractor failed"),
  );
  process.exit(1);
}

console.log(JSON.stringify(result.jobs, null, 2));
