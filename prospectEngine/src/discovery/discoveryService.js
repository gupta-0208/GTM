import {
  generateSearchPlan,
} from "./queryGenerator.js";

import { LINKASSIST_ICP } from "../icp/linkassist.js";

import searxngSource from "../sources/searxng/index.js";

import {
  upsertCrawlTargets,
} from "../storage/pgStore.js";

import {
  createOpenaiProvider,
} from "../parse/llm/openai.js";

import {
  createDisabledProvider,
} from "../parse/llm/disabled.js";

import {
  config,
} from "../config.js";

import {
  rankCandidates,
} from "../relevance/companyRelevance.js";

// Relevance runs through OpenAI when enabled.
// If relevance is disabled or the OpenAI key is missing,
// use the disabled provider so ranking fails closed.
function createRelevanceProvider() {
  if (!config.relevanceEnabled || !config.openaiEnabled) {
    return createDisabledProvider();
  }

  if (!config.openaiApiKey) {
    return createDisabledProvider();
  }

  return createOpenaiProvider(config);
}

export async function discover(
  userQuery,
  icp = LINKASSIST_ICP,
) {
  console.log("");
  console.log(
    "========================================",
  );
  console.log(
    "DAY 1 — DISCOVERY",
  );
  console.log(
    "========================================",
  );

  console.log(
    `USER QUERY: ${userQuery}`,
  );

  const searchPlan =
    await generateSearchPlan(
      userQuery,
      icp,
    );

  console.log("");
  console.log(
    "GENERATED AI SEARCH QUERIES:",
  );

  searchPlan.search_queries.forEach(
    (query, index) => {
      console.log(
        `${index + 1}. ${query}`,
      );
    },
  );

  const rawTargets =
    await searxngSource.discover(
      searchPlan,
      {
        generatedQueries:
          searchPlan.search_queries,
      },
    );

  console.log("");
  console.log(
    `Raw candidates from SearXNG: ${rawTargets.length}`,
  );

  const provider =
    createRelevanceProvider();

  const ranked =
    await rankCandidates({
      userQuery,
      searchPlan,
      candidates: rawTargets,
      provider,
    });

  // Only relevance-approved candidates are allowed into the crawl queue.
  const targets = ranked.approved;

  console.log("");
  console.log(
    "RELEVANT COMPANY TARGETS:",
  );

  if (!targets.length) {
    console.log(
      "No company targets approved by relevance.",
    );
  } else {
    targets.forEach(
      (target, index) => {
        console.log(
          `${index + 1}. ${target.domain} → ${
            target.title || target.url
          }`,
        );
      },
    );
  }

  const persistedTargets =
    await upsertCrawlTargets(
      targets,
    );

  console.log("");
  console.log(
    "DISCOVERY RESULT",
  );

  console.log(
    `Targets discovered: ${rawTargets.length}`,
  );

  console.log(
    `Targets relevant: ${targets.length}`,
  );

  console.log(
    `Targets rejected: ${ranked.rejected.length}`,
  );

  console.log(
    `Targets review: ${ranked.review.length}`,
  );

  console.log(
    `Relevance status: ${ranked.relevanceStatus}`,
  );

  console.log(
    `Relevance provider: ${ranked.provider}`,
  );

  console.log(
    `Relevance model: ${ranked.model || "none"}`,
  );

  console.log(
    `Targets persisted: ${persistedTargets.length}`,
  );

  console.log("");

  console.log(
    "CRAWL TARGETS:",
  );

  targets.forEach(
    (target, index) => {
      console.log(
        `${index + 1}. ${target.url}`,
      );
    },
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
      review: ranked.review.length,
    },

    statistics: {
      targetsDiscovered:
        rawTargets.length,

      targetsRelevant:
        targets.length,

      targetsPersisted:
        persistedTargets.length,

      targetsRejected:
        ranked.rejected.length,

      targetsReview:
        ranked.review.length,
    },
  };
}