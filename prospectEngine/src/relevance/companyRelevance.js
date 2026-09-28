import { z } from "zod";

import { config } from "../config.js";

import { normalizeUrl } from "../lib/url.js";

const DecisionSchema = z.object({
  url: z.string(),
  relevant: z.boolean(),
  score: z.number().min(0).max(1),
  type: z.enum([
    "company",
    "company_profile",
    "person",
    "directory",
    "irrelevant",
    "unknown",
  ]),
  reason_code: z.string(),
  confidence: z.number().min(0).max(1),
});

const BatchSchema = z.object({
  decisions: z.array(DecisionSchema),
});

const RELEVANCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          relevant: { type: "boolean" },
          score: { type: "number" },
          type: {
            type: "string",
            enum: [
              "company",
              "company_profile",
              "person",
              "directory",
              "irrelevant",
              "unknown",
            ],
          },
          reason_code: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "url",
          "relevant",
          "score",
          "type",
          "reason_code",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
};

// Domains that are never target companies and are filtered deterministically
// before any LLM call. Social/profile, search engines, directories and wikis.
const EXCLUDED_DOMAINS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "g2.com",
  "capterra.com",
  "crunchbase.com",
  "glassdoor.com",
  "indeed.com",
  "trustpilot.com",
  "yelp.com",
  "angellist.com",
  "wellfound.com",
  "google.com",
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "baidu.com",
  "ask.com",
]);

const EXCLUDED_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|avif|bmp|tif|tiff|css|js|map|json|xml|woff2?|ttf|eot|otf|mp3|mp4|webm|ogg|zip|rar|7z|gz|tar|bz2|pdf|docx?|xlsx?|pptx?|ppt|epub|csv|exe|dmg|apk)$/i;

const SEARCH_RESULT_PATTERNS = [
  /\/search\?/i,
  /\/(search|results|find)\/?$/i,
  /\/s\?/i,
];

function modelNameFor(providerName) {
  return providerName === "gemini" ? config.llmGeminiModel : config.openaiModel;
}

function isSearchResultUrl(url) {
  return SEARCH_RESULT_PATTERNS.some((pattern) => pattern.test(url));
}

export function normalizeCandidate(candidate) {
  const normalized = normalizeUrl(candidate?.url);

  if (!normalized) {
    return {
      ...candidate,
      valid: false,
      reason_code: "malformed_url",
    };
  }

  return {
    ...candidate,
    url: normalized.normalizedUrl,
    baseUrl: normalized.baseUrl,
    domain: normalized.domain,
    valid: true,
  };
}

export function deterministicFilter(candidates) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of candidates || []) {
    const candidate = normalizeCandidate(raw);

    if (!candidate.valid) {
      rejected.push({
        candidate,
        reason_code: "malformed_url",
      });

      continue;
    }

    if (EXCLUDED_EXTENSIONS.test(candidate.url)) {
      rejected.push({
        candidate,
        reason_code: "non_html_asset",
      });

      continue;
    }

    if (EXCLUDED_DOMAINS.has(candidate.domain)) {
      rejected.push({
        candidate,
        reason_code: "excluded_domain",
      });

      continue;
    }

    if (isSearchResultUrl(candidate.url)) {
      rejected.push({
        candidate,
        reason_code: "search_result_page",
      });

      continue;
    }

    if (seen.has(candidate.url)) {
      rejected.push({
        candidate,
        reason_code: "duplicate_url",
      });

      continue;
    }

    seen.add(candidate.url);
    accepted.push(candidate);
  }

  return { accepted, rejected };
}

function buildPrompt(userQuery, batch) {
  const lines = batch.map(
    (candidate, index) =>
      `${index + 1}. URL: ${candidate.url}\n` +
      `   Domain: ${candidate.domain}\n` +
      `   Title: ${candidate.title || ""}\n` +
      `   Snippet: ${candidate.snippet || ""}`,
  );

  return `You are the relevance filter for a B2B prospect discovery system.

The user query is: "${userQuery}"

Classify whether each of the following candidate URLs represents a relevant
target company website for the query. Only classify URLs already listed below.
Never invent or modify URLs.

For each URL decide:
- relevant: true when the URL is a real company website (or a page on one)
  that matches the query's industry/product/technology intent.
- score: 0..1, higher means more likely a relevant target company.
- type: "company", "company_profile", "person", "directory", "irrelevant",
  or "unknown".
- reason_code: a short snake_case reason such as "matches_industry",
  "directory_listing", "news_article", "vendor_partner", "unrelated".
- confidence: 0..1, how confident you are in this single decision.

Candidates:

${lines.join("\n\n")}`;
}

export async function classifyCandidates(provider, userQuery, batch) {
  const prompt = buildPrompt(userQuery, batch);

  const result = await provider.complete({
    prompt,
    jsonSchema: RELEVANCE_JSON_SCHEMA,
  });

  if (!result.attempted || !result.ok || !result.data) {
    return {
      ok: false,
      error: result.error || "relevance provider unavailable",
      usage: result.usage || null,
      decisions: [],
    };
  }

  try {
    const parsed = BatchSchema.parse(result.data);
    const candidateUrls = new Set(
      batch
        .map((candidate) => normalizeCandidate(candidate))
        .filter((candidate) => candidate.valid)
        .map((candidate) => candidate.url),
    );
    const returnedUrls = new Set(
      parsed.decisions
        .map((decision) => normalizeCandidate({ url: decision.url }))
        .filter((candidate) => candidate.valid)
        .map((candidate) => candidate.url),
    );
    const missing = [...candidateUrls].filter((url) => !returnedUrls.has(url));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `relevance output missing ${missing.length} candidate decision(s)`,
        usage: result.usage || null,
        decisions: [],
      };
    }

    return {
      ok: true,
      usage: result.usage || null,
      decisions: parsed.decisions,
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid relevance output: ${error.message}`,
      usage: result.usage || null,
      decisions: [],
    };
  }
}

function fallbackRelevance(providerName, reasonCode) {
  return {
    status: "fallback",
    relevant: true,
    score: null,
    type: null,
    reason_code: reasonCode,
    confidence: null,
    provider: providerName,
    model: null,
  };
}

export async function rankCandidates({
  userQuery,
  candidates,
  provider,
  threshold = config.openaiRelevanceThreshold,
} = {}) {
  const { accepted, rejected } = deterministicFilter(candidates);

  const providerName = provider?.name || "disabled";

  const model = modelNameFor(providerName);

  const llmAvailable =
    provider && provider.name !== "disabled" && config.relevanceEnabled;

  if (!accepted.length) {
    return {
      approved: [],
      rejected,
      provider: providerName,
      model: llmAvailable ? model : null,
      relevanceStatus: "none",
      decisions: [],
    };
  }

  if (!llmAvailable) {
    const blocked = accepted.map((candidate) => ({
      ...candidate,
      relevance: {
        status: "llm-required",
        relevant: false,
        score: null,
        type: "unknown",
        reason_code: "llm-unavailable",
        confidence: null,
        provider: providerName,
        model: null,
      },
    }));

    return {
      approved: [],
      rejected: [...rejected, ...blocked],
      provider: providerName,
      model: null,
      relevanceStatus: "blocked",
      decisions: [],
    };
  }

  const decisions = [];
  let failed = false;

  for (let i = 0; i < accepted.length; i += config.relevanceBatchSize) {
    const batch = accepted.slice(i, i + config.relevanceBatchSize);

    const result = await classifyCandidates(provider, userQuery, batch);

    if (result.ok) {
      decisions.push(...result.decisions);
    } else {
      failed = true;
      break;
    }
  }

  if (failed || !decisions.length) {
    const approved = accepted.map((candidate) => ({
      ...candidate,
      relevance: fallbackRelevance(providerName, "llm-unavailable"),
    }));

    return {
      approved,
      rejected,
      provider: providerName,
      model,
      relevanceStatus: "fallback",
      decisions,
    };
  }

  const decisionByUrl = new Map(
    decisions
      .map((decision) => {
        const normalized = normalizeCandidate({ url: decision.url });
        return normalized.valid ? [normalized.url, decision] : null;
      })
      .filter(Boolean),
  );

  const approved = [];
  const llmRejected = [];

  for (const candidate of accepted) {
    const decision = decisionByUrl.get(candidate.url);

    if (!decision) {
      llmRejected.push({
        ...candidate,
        relevance: {
          status: "no-decision",
          relevant: false,
          score: null,
          type: "unknown",
          reason_code: "no-decision",
          confidence: null,
          provider: providerName,
          model,
        },
      });
      continue;
    }

    const approvedByScore = decision.score >= threshold;

    const relevant = decision.relevant && approvedByScore;

    const relevance = {
      status: relevant
        ? "approved"
        : decision.relevant
          ? "below-threshold"
          : "rejected",
      relevant,
      score: decision.score,
      type: decision.type,
      reason_code: decision.reason_code,
      confidence: decision.confidence,
      provider: providerName,
      model,
    };

    if (relevant) {
      approved.push({
        ...candidate,
        relevance,
      });
    } else {
      llmRejected.push({
        ...candidate,
        relevance,
      });
    }
  }

  return {
    approved,
    rejected: [...rejected, ...llmRejected],
    provider: providerName,
    model,
    relevanceStatus: "classified",
    decisions,
  };
}
