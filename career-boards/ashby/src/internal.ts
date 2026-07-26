export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export async function fetchAshbyJson<T>(
  fetchFn: typeof fetch,
  input: {
    url: string;
    signal?: AbortSignal;
    headers?: HeadersInit;
  },
): Promise<T> {
  const response = await fetchFn(input.url, {
    method: "GET",
    signal: input.signal,
    headers: input.headers,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Ashby request failed with HTTP ${response.status} for ${input.url}.`,
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Ashby response was not valid JSON for ${input.url}.`);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function requiredString(
  value: unknown,
  fieldName: string,
  url: string,
): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(
    `Ashby response is missing required field ${fieldName} for ${url}.`,
  );
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
