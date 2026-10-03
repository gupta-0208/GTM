import {
  generateSearchPlan,
  generateSupplementaryQueries,
} from "./queryGenerator.js";

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

// How many approved targets to aim for before stopping early.
const DEFAULT_TARGET_COUNT = 10;

function createRelevanceProvider() {
  if (
    !config.relevanceEnabled ||
    !config.openaiEnabled
  ) {
    return createDisabledProvider();
  }

  if (
    !config.openaiApiKey
  ) {
    return createDisabledProvider();
  }

  return createOpenaiProvider(
    config,
  );
}

//
// Run one search round: fetch candidates from SearXNG for the given queries,
// then classify them through the relevance gate.
//
async function runSearchRound({
  userQuery,
  searchPlan,
  queries,
  provider,
  roundLabel,
}) {
  console.log("");
  console.log(`${roundLabel} QUERIES (${queries.length}):`);
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  const rawTargets =
    await searxngSource.discover(
      searchPlan,
      {
        generatedQueries: queries,
      },
    );

  console.log("");
  console.log(`${roundLabel} raw candidates: ${rawTargets.length}`);

  if (!rawTargets.length) {
    return {
      rawTargets: [],
      ranked: {
        approved: [],
        rejected: [],
        review: [],
        relevanceStatus: "none",
        provider: "disabled",
        model: null,
        decisions: [],
      },
    };
  }

  const ranked =
    await rankCandidates({
      userQuery,
      searchPlan,
      candidates: rawTargets,
      provider,
    });

  return { rawTargets, ranked };
}

export async function discover(
  userQuery,
  icp = null,
  targetCount = DEFAULT_TARGET_COUNT,
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
    "GENERATED SEARCH QUERIES:",
  );

  searchPlan.search_queries.forEach(
    (query, index) => {
      console.log(
        `${index + 1}. ${query}`,
      );
    },
  );

  const provider =
    createRelevanceProvider();

  // ────────────────────────────────────────────────────────────────────────
  // ROUND 1 — Primary queries
  // ────────────────────────────────────────────────────────────────────────
  const round1 =
    await runSearchRound({
      userQuery,
      searchPlan,
      queries: searchPlan.search_queries,
      provider,
      roundLabel: "ROUND 1",
    });

  const allRawTargets = [
    ...round1.rawTargets,
  ];

  let allApproved = [
    ...round1.ranked.approved,
  ];

  let allRejected = [
    ...round1.ranked.rejected,
  ];

  let allReview = [
    ...round1.ranked.review,
  ];

  const queriesUsed = [
    ...searchPlan.search_queries,
  ];

  // ────────────────────────────────────────────────────────────────────────
  // ROUND 2 — Supplementary queries (only if we still need more targets)
  // ────────────────────────────────────────────────────────────────────────
  if (allApproved.length < targetCount) {
    console.log("");
    console.log(
      `ROUND 1 approved ${allApproved.length}/${targetCount} targets. ` +
      `Running supplementary search round...`,
    );

    const supplementaryQueries =
      generateSupplementaryQueries(userQuery, icp);

    // De-duplicate against already-used queries.
    const usedSet = new Set(queriesUsed);
    const freshSupplementary =
      supplementaryQueries.filter((q) => !usedSet.has(q));

    if (freshSupplementary.length > 0) {
      const round2 =
        await runSearchRound({
          userQuery,
          searchPlan,
          queries: freshSupplementary,
          provider,
          roundLabel: "ROUND 2",
        });

      // Merge — avoid duplicate domains already approved in Round 1.
      const approvedDomains =
        new Set(allApproved.map((t) => t.domain));

      const newApproved =
        round2.ranked.approved.filter(
          (t) => !approvedDomains.has(t.domain),
        );

      allRawTargets.push(...round2.rawTargets);
      allApproved.push(...newApproved);
      allRejected.push(...round2.ranked.rejected);
      allReview.push(...round2.ranked.review);
      queriesUsed.push(...freshSupplementary);
    } else {
      console.log(
        "No additional supplementary queries available.",
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Warn clearly if we still have nothing to crawl.
  // ────────────────────────────────────────────────────────────────────────
  if (!allApproved.length) {
    console.log("");
    console.log(
      "⚠  DISCOVERY: Zero approved targets after all rounds.",
    );
    console.log(
      "   Possible causes:",
    );
    console.log(
      "   • SearXNG is returning noise — check SearXNG engines/config.",
    );
    console.log(
      "   • OpenAI relevance is unavailable — check OPENAI_API_KEY.",
    );
    console.log(
      "   • All candidates are genuinely irrelevant to the ICP.",
    );
    console.log(
      "   Stopping before crawl. Do NOT proceed to crawl with 0 targets.",
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Print approved targets
  // ────────────────────────────────────────────────────────────────────────
  console.log("");
  console.log(
    "RELEVANT COMPANY TARGETS:",
  );

  if (!allApproved.length) {
    console.log(
      "No company targets approved by relevance.",
    );
  } else {
    allApproved.forEach(
      (target, index) => {
        console.log(
          `${index + 1}. ${target.domain} → ${
            target.title ||
            target.url
          }`,
        );
      },
    );
  }

  const persistedTargets =
    await upsertCrawlTargets(
      allApproved,
    );

  const searchEngines = allRawTargets.reduce((counts, target) => {
    const engine = target.search_engine || "unknown";
    counts[engine] = (counts[engine] || 0) + 1;
    return counts;
  }, {});

  // ────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────
  console.log("");
  console.log(
    "DISCOVERY RESULT",
  );

  console.log(
    `Queries used: ${queriesUsed.length}`,
  );

  console.log(
    `Targets discovered (raw): ${allRawTargets.length}`,
  );

  console.log(
    `Targets relevant (approved): ${allApproved.length}`,
  );

  console.log(
    `Targets rejected: ${allRejected.length}`,
  );

  console.log(
    `Targets review: ${allReview.length}`,
  );

  console.log(
    `Targets persisted: ${persistedTargets.length}`,
  );

  console.log("");
  console.log(
    "CRAWL TARGETS:",
  );

  allApproved.forEach(
    (target, index) => {
      console.log(
        `${index + 1}. ${target.url}`,
      );
    },
  );

  return {
    userQuery,

    searchPlan,

    targets: allApproved,

    relevance: {
      status:
        round1.ranked.relevanceStatus,

      provider:
        round1.ranked.provider,

      model:
        round1.ranked.model,

      rejected:
        allRejected.length,

      review:
        allReview.length,
    },

    statistics: {
      targetsDiscovered:
        allRawTargets.length,

      targetsRelevant:
        allApproved.length,

      targetsPersisted:
        persistedTargets.length,

      targetsRejected:
        allRejected.length,

      targetsReview:
        allReview.length,
      searchEngines,
    },
  };
}
