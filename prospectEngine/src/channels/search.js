import { config } from "../config.js";
import { createChannel } from "./_backend.js";

async function fetchWithTimeout(
  url,
  timeoutMs = 20000
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": config.crawlerUserAgent,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const searxngBackend = {
  name: "searxng",

  async probe() {
    const response = await fetchWithTimeout(
      `${config.searxngUrl}/`,
      10000
    );

    if (!response.ok) {
      throw new Error(
        `SearXNG probe failed: HTTP ${response.status}`
      );
    }

    return true;
  },

  async run({
    query,
    page = 1,
    language = "en",
    limit = config.searchResultsPerQuery,
  }) {
    const endpoint = new URL(
      `${config.searxngUrl}/search`
    );

    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set(
      "language",
      language
    );
    endpoint.searchParams.set(
      "categories",
      "general"
    );
    endpoint.searchParams.set(
      "engines",
      "bing"
    );
    endpoint.searchParams.set(
      "pageno",
      String(page)
    );

    const response = await fetchWithTimeout(
      endpoint.toString()
    );

    if (!response.ok) {
      const body = await response.text();

      throw new Error(
        `SearXNG returned HTTP ${response.status}: ${body.slice(
          0,
          300
        )}`
      );
    }

    const data = await response.json();

    const results = Array.isArray(data.results)
      ? data.results
      : [];

    return results
      .map((result) => ({
        title:
          typeof result.title === "string"
            ? result.title
            : "",

        url:
          typeof result.url === "string"
            ? result.url
            : "",

        content:
          typeof result.content === "string"
            ? result.content
            : "",

        engine:
          typeof result.engine === "string"
            ? result.engine
            : null,

        category:
          typeof result.category === "string"
            ? result.category
            : null,
      }))
      .filter(
        (result) =>
          result.url.startsWith("http://") ||
          result.url.startsWith("https://")
      )
      .slice(0, limit);
  },
};

export const searchChannel = createChannel({
  type: "search",
  backends: [searxngBackend],
});