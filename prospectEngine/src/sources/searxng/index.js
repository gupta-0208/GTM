import { config } from "../../config.js";
import { searchChannel } from "../../channels/search.js";

import { buildDorkQueries } from "./dorks.js";

import { normalizeUrl } from "../../lib/url.js";
import { dedupeByDomain } from "../../lib/dedupe.js";

import {
  getSearchCache,
  setSearchCache,
} from "../../storage/localStore.js";

const NON_COMPANY_DOMAINS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "wikipedia.org",
  "g2.com",
  "capterra.com",
  "crunchbase.com",
  "glassdoor.com",
  "indeed.com",
]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function cacheKey(query, page) {
  return `${query}::${page}`;
}

function isCacheFresh(entry) {
  // Allow a hard bypass so a fresh run always fetches live results.
  if (config.searxngBypassCache) {
    return false;
  }

  if (!entry) {
    return false;
  }

  const cachedTime = new Date(entry.cachedAt).getTime();

  if (!Number.isFinite(cachedTime)) {
    return false;
  }

  const age = Date.now() - cachedTime;

  const maxAge =
    config.searxngCacheTtlDays *
    24 *
    60 *
    60 *
    1000;

  return age < maxAge;
}

function makeTarget({
  result,
  query,
  position,
}) {
  const normalized = normalizeUrl(result.url);

  if (!normalized) {
    return null;
  }

  if (NON_COMPANY_DOMAINS.has(normalized.domain)) {
    return null;
  }

  return {
    domain: normalized.domain,
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,

    priority: Math.max(1, position),

    source_type: "searxng",

    depth: 0,

    state: "queued",

    attempts: 0,

    next_attempt_at: null,

    discovered_by: "searxng",

    title: result.title || "",
    snippet: result.content || "",

    matchedQueries: [query],

    occurrences: 1,
  };
}

export default {
  type: "searxng",

  capabilities: {
    companies: true,
    contacts: false,
    emails: false,
  },

  async discover(
    icp,
    {
      limit = config.discoveryLimit,
      generatedQueries = [],
    } = {}
  ) {
    const queries = [
      ...generatedQueries,
      ...buildDorkQueries(icp),
    ]
      .map((query) => query.trim())
      .filter(Boolean);

    const uniqueQueries = [
      ...new Set(queries),
    ].slice(0, config.maxSearchQueries);

    const candidates = [];

    const cache = await getSearchCache();

    for (
      let queryIndex = 0;
      queryIndex < uniqueQueries.length;
      queryIndex++
    ) {
      const query = uniqueQueries[queryIndex];

      console.log("");
      console.log(
        `[Discovery ${queryIndex + 1}/${uniqueQueries.length}]`
      );

      for (
        let page = 1;
        page <= config.searchPagesPerQuery;
        page++
      ) {
        const key = cacheKey(query, page);

        let results;

        if (isCacheFresh(cache[key])) {
          console.log(
            `Cache hit: "${query}" page ${page}`
          );

          results = cache[key].results;
        } else {
          console.log(
            `SearXNG: "${query}" page ${page}`
          );

          try {
            results = await searchChannel.run({
              query,
              page,
              language: "en",
              limit: config.searchResultsPerQuery,
            });

            await setSearchCache(key, {
              cachedAt: new Date().toISOString(),
              results,
            });
          } catch (error) {
            console.error(
              `Search failed: ${query}`
            );

            console.error(error.message);

            results = [];
          }
        }

        for (
          let resultIndex = 0;
          resultIndex < results.length;
          resultIndex++
        ) {
          const target = makeTarget({
            result: results[resultIndex],
            query,
            position: resultIndex + 1,
          });

          if (target) {
            candidates.push(target);
          }
        }
      }

      if (
        queryIndex <
        uniqueQueries.length - 1
      ) {
        console.log(
          `Waiting ${
            config.searxngQueryDelayMs / 1000
          }s before next search query...`
        );

        await sleep(
          config.searxngQueryDelayMs
        );
      }
    }

    const uniqueCandidates =
      dedupeByDomain(candidates);

    return uniqueCandidates.slice(
      0,
      limit
    );
  },
};