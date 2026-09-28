import { parse } from "tldts";

const TRACKING_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
]);

export function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    for (const parameter of [
      ...url.searchParams.keys(),
    ]) {
      if (
        TRACKING_PARAMETERS.has(
          parameter.toLowerCase()
        )
      ) {
        url.searchParams.delete(parameter);
      }
    }

    url.hash = "";

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(
        /\/+$/,
        ""
      );
    }

    const parsed = parse(url.hostname);

    return {
      originalUrl: rawUrl,
      normalizedUrl: url.toString(),
      baseUrl: url.origin,
      hostname: url.hostname,
      domain:
        parsed.domain || url.hostname,
    };
  } catch {
    return null;
  }
}