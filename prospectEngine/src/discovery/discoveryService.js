import {
  generateSearchPlan,
} from "./queryGenerator.js";

import searxngSource from "../sources/searxng/index.js";

import {
  upsertCrawlTargets,
} from "../storage/pgStore.js";

import {
  createProvider,
} from "../parse/llm/provider.js";

import {
  config,
} from "../config.js";

import {
  rankCandidates,
} from "../relevance/companyRelevance.js";

export async function discover(
  userQuery
) {
  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "DAY 1 — DISCOVERY"
  );
  console.log(
    "========================================"
  );

  console.log(
    `USER QUERY: ${userQuery}`
  );

  const searchPlan =
    await generateSearchPlan(
      userQuery
    );

  console.log("");
  console.log(
    "GENERATED AI SEARCH QUERIES:"
  );

  searchPlan.search_queries.forEach(
    (query, index) => {
      console.log(
        `${index + 1}. ${query}`
      );
    }
  );

  const rawTargets =
    await searxngSource.discover(
      searchPlan,
      {
        generatedQueries:
          searchPlan.search_queries,
      }
    );

  const provider =
    createProvider(config);

  const ranked =
    await rankCandidates({
      userQuery,
      candidates: rawTargets,
      provider,
    });

  const targets = ranked.approved;

  const persistedTargets =
    await upsertCrawlTargets(
      targets
    );

  console.log("");
  console.log(
    "DISCOVERY RESULT"
  );

  console.log(
    `Targets discovered: ${rawTargets.length}`
  );

  console.log(
    `Targets relevant: ${targets.length}`
  );

  console.log(
    `Relevance status: ${ranked.relevanceStatus}`
  );

  console.log(
    `Targets persisted: ${persistedTargets.length}`
  );

  console.log("");
  console.log(
    "CRAWL TARGETS:"
  );

  targets
    .forEach(
      (target, index) => {
        console.log(
          `${index + 1}. ${target.url}`
        );
      }
    );

  return {
    userQuery,
    searchPlan,
    targets,
    relevance: {
      status: ranked.relevanceStatus,
      provider: ranked.provider,
      model: ranked.model,
      rejected: ranked.rejected.length,
    },
    statistics: {
      targetsDiscovered:
        rawTargets.length,

      targetsRelevant:
        targets.length,

      targetsPersisted:
        persistedTargets.length,
    },
  };
}