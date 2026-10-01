import { z } from "zod";

import { config } from "../config.js";

import { normalizeUrl } from "../lib/url.js";

import {
  isBlockedDomain,
  isListicleTitle,
} from "./blocklist.js";

// The LLM returns *facts* about each root domain, never a final qualification.
// Code in decideFromFacts makes the approve/reject/review decision. This keeps
// the decision deterministic and means a model score can never promote a
// non-company into the crawl queue.










const DecisionSchema = z.object({
  domain: z.string(),
  type: z.enum([
    "company",
    "company_profile",
    "person",
    "directory",
    "media",
    "article",
    "job_board",
    "review_site",
    "educational",
    "generic_info",
    "listicle",
    "vendor_partner",
    "unknown",
  ]),
  is_company_website: z.boolean().nullable(),
  matches_search_plan: z.boolean().nullable(),
  reason_code: z.string(),
  evidence: z.string(),
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
          domain: { type: "string" },
          type: {
            type: "string",
            enum: [
              "company",
              "company_profile",
              "person",
              "directory",
              "media",
              "article",
              "job_board",
              "review_site",
              "educational",
              "generic_info",
              "listicle",
              "vendor_partner",
              "unknown",
            ],
          },
          is_company_website: {
  type: ["boolean", "null"],
},
          matches_search_plan: {
  type: ["boolean", "null"],
},
          reason_code: { type: "string" },
          evidence: { type: "string" },
        },
        required: [
          "domain",
          "type",
          "is_company_website",
          "matches_search_plan",
          "reason_code",
          "evidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
};

const EXCLUDED_TYPES = new Set([
  "company_profile",
  "directory",
  "media",
  "article",
  "job_board",
  "review_site",
  "educational",
  "generic_info",
  "listicle",
  "person",
]);

const EXCLUDED_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|avif|bmp|tif|tiff|css|js|map|json|xml|woff2?|ttf|eot|otf|mp3|mp4|webm|ogg|zip|rar|7z|gz|tar|bz2|pdf|docx?|xlsx?|pptx?|ppt|epub|csv|exe|dmg|apk)$/i;

const SEARCH_RESULT_PATTERNS = [
  /\/search\?/i,
  /\/(search|results|find)\/?$/i,
  /\/s\?/i,
];

function isSearchResultUrl(url) {
  return SEARCH_RESULT_PATTERNS.some((pattern) => pattern.test(url));
}

function modelNameFor(providerName) {
  return providerName === "gemini" ? config.llmGeminiModel : config.openaiModel;
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
    hostname: normalized.hostname,
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
      rejected.push({ candidate, reason_code: "malformed_url" });
      continue;
    }

    if (EXCLUDED_EXTENSIONS.test(candidate.url)) {
      rejected.push({ candidate, reason_code: "non_html_asset" });
      continue;
    }

    if (isBlockedDomain(candidate.hostname || candidate.domain)) {
      rejected.push({ candidate, reason_code: "excluded_domain" });
      continue;
    }

    if (isListicleTitle(candidate.title)) {
      rejected.push({ candidate, reason_code: "listicle_title" });
      continue;
    }

    if (isSearchResultUrl(candidate.url)) {
      rejected.push({ candidate, reason_code: "search_result_page" });
      continue;
    }

    if (seen.has(candidate.url)) {
      rejected.push({ candidate, reason_code: "duplicate_url" });
      continue;
    }

    seen.add(candidate.url);
    accepted.push(candidate);
  }

  return { accepted, rejected };
}

function buildPrompt(userQuery, searchPlan, domains) {
  const lines = domains.map(
    (candidate, index) =>
      `${index + 1}. Domain: ${candidate.domain}\n` +
      `   Title: ${candidate.title || ""}\n` +
      `   Snippet: ${candidate.snippet || ""}`,
  );

  const plan = [
    searchPlan?.target_description,
    searchPlan?.industry,
    searchPlan?.location,
    searchPlan?.company_type,
    searchPlan?.product_or_technology,
    searchPlan?.relationship,
  ]
    .filter(Boolean)
    .join("; ");

  return `You are a fact-extraction helper for LinkAssist prospect discovery.

Your job is NOT to invent prospects and NOT to return a general web result.
Your job is to determine whether each domain is the official website of a real
operating company that fits the LinkAssist discovery criteria.

LINKASSIST ICP

Geography:
- India

Target business types:
- B2B SaaS
- software companies
- marketing agencies
- AI agencies
- consulting firms
- business consultants
- business coaches
- professional services
- IT/software services
- recruitment/staffing agencies

Preferred company profile:
- founder-led or expert-led
- small business, approximately 1-50 employees

Likely buyer:
- founder
- CEO
- consultant
- coach
- agency owner
- senior B2B professional

The founder-led and company-size signals are supporting signals.
Do NOT invent them when they are not visible in the supplied evidence.

REJECT these source types:
- directories
- aggregators
- marketplaces
- media
- news
- articles
- blogs
- listicles
- podcasts
- communities
- job boards
- review sites
- educational sites
- generic information pages
- third-party company profiles

A page ABOUT a company is NOT the company's own website.
A directory listing a company is NOT the company's own website.
A news article mentioning a company is NOT the company's own website.

USER QUERY:
"${userQuery}"

SEARCH PLAN:
${plan || "(none)"}

For each domain, return ONLY these facts:

1. type

Use exactly one:
company
company_profile
person
directory
media
article
job_board
review_site
educational
generic_info
listicle
vendor_partner
unknown

Use "company" only for the official website of the operating company itself.

2. is_company_website

true only when the domain itself is the official website of the operating company.

false for directories, articles, media, communities, job sites,
third-party profiles and other non-company sources.

Use null when there is not enough evidence.

3. matches_search_plan

true only when the COMPANY ITSELF matches the core LinkAssist target:
India + relevant B2B business type.

Do not mark true merely because the page mentions a relevant company.

Do not require founder-led or employee-count evidence when the supplied
title/snippet cannot establish it. Do not invent it.

Use false when the company clearly does not match.
Use null when evidence is insufficient.

4. reason_code

Use a short snake_case reason such as:
matches_business_type
matches_location
founder_led_signal
small_company_signal
directory_listing
third_party_profile
news_article
listicle
job_board
community
wrong_industry
wrong_geo
unrelated
insufficient_evidence

5. evidence

Give a short evidence statement based ONLY on the supplied title and snippet.

Never invent:
- company size
- founders
- location
- products
- customers
- technology usage

When evidence is insufficient, leave evidence empty.

IMPORTANT APPROVAL GUIDANCE

A domain should only be considered a strong candidate when:
- it is the company's own official website
- it represents a real operating company
- the company itself fits the core LinkAssist business categories
- the evidence does not merely come from an article, directory or third-party listing

Never turn a directory, listicle, news article, publication or community into
a company prospect just because it mentions relevant companies.

Only classify the domains listed below.
Never invent domains.

DOMAINS:

${lines.join("\n\n")}`;
}

export async function classifyCandidates(provider, { userQuery, searchPlan }, domains) {
  const prompt = buildPrompt(userQuery, searchPlan, domains);

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
    const candidateDomains = new Set(
      domains.map((candidate) => String(candidate.domain || "").toLowerCase()),
    );
    const returnedDomains = new Set(
      parsed.decisions.map((decision) =>
        String(decision.domain || "").toLowerCase(),
      ),
    );
    const missing = [...candidateDomains].filter(
      (domain) => !returnedDomains.has(domain),
    );

    if (missing.length > 0) {
      return {
        ok: false,
        error: `relevance output missing ${missing.length} domain decision(s)`,
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

// Code-based final decision. The LLM only supplied facts.
export function decideFromFacts(facts, { providerName, model } = {}) {
  if (!facts) {
    return {
      status: "review",
      relevant: false,
      type: "unknown",
      reason_code: "no-decision",
      evidence: "",
      provider: providerName,
      model,
    };
  }

  if (facts.is_company_website === false) {
    return {
      status: "rejected",
      relevant: false,
      type: facts.type,
      reason_code: facts.reason_code || "not_company_website",
      evidence: facts.evidence || "",
      provider: providerName,
      model,
    };
  }

  if (EXCLUDED_TYPES.has(facts.type)) {
    return {
      status: "rejected",
      relevant: false,
      type: facts.type,
      reason_code: facts.reason_code || facts.type,
      evidence: facts.evidence || "",
      provider: providerName,
      model,
    };
  }

  if (
    facts.is_company_website === true &&
    facts.matches_search_plan === true
  ) {
    return {
      status: "approved",
      relevant: true,
      type: facts.type,
      reason_code: facts.reason_code || "matches_search_plan",
      evidence: facts.evidence || "",
      provider: providerName,
      model,
    };
  }

  if (facts.matches_search_plan === false) {
    return {
      status: "rejected",
      relevant: false,
      type: facts.type,
      reason_code: facts.reason_code || "not_matching_search_plan",
      evidence: facts.evidence || "",
      provider: providerName,
      model,
    };
  }

  return {
    status: "review",
    relevant: false,
    type: facts.type,
    reason_code: facts.reason_code || "insufficient_evidence",
    evidence: facts.evidence || "",
    provider: providerName,
    model,
  };
}

function reviewDecision(reasonCode) {
  return {
    status: "review",
    relevant: false,
    type: "unknown",
    reason_code: reasonCode,
    evidence: "",
  };
}

function groupByDomain(candidates) {
  const map = new Map();

  for (const candidate of candidates) {
    const domain = candidate.domain;

    if (!map.has(domain)) {
      map.set(domain, []);
    }

    map.get(domain).push(candidate);
  }

  return map;
}

function representativeFor(candidates) {
  const withText = candidates.find(
    (c) => c.title || c.snippet,
  );

  const candidate = withText || candidates[0];

  return {
    domain: candidate.domain,
    title: candidate.title || "",
    snippet: candidate.snippet || "",
    url: candidate.url,
  };
}

export async function rankCandidates({
  userQuery,
  searchPlan = null,
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
      review: [],
      provider: providerName,
      model: llmAvailable ? model : null,
      relevanceStatus: "none",
      decisions: [],
    };
  }

  // Judge by root domain: one verdict applies to every URL on that domain.
  const domainGroups = groupByDomain(accepted);

  if (!llmAvailable) {
    const review = [];

    for (const domainCandidates of domainGroups.values()) {
      for (const candidate of domainCandidates) {
        review.push({
          ...candidate,
          relevance: {
            ...reviewDecision("llm-unavailable"),
            provider: providerName,
            model: null,
          },
        });
      }
    }

    return {
      approved: [],
      rejected,
      review,
      provider: providerName,
      model: null,
      relevanceStatus: "review",
      decisions: [],
    };
  }

  const decisions = [];
  const domainBatches = [];
  const domainList = [...domainGroups.keys()];

  for (let i = 0; i < domainList.length; i += config.relevanceBatchSize) {
    const batchDomains = domainList.slice(i, i + config.relevanceBatchSize);
    const batchRepresentatives = batchDomains.map((domain) =>
      representativeFor(domainGroups.get(domain)),
    );

    // Retry a failed batch once; if it still fails, only that batch goes to
    // review and the remaining batches continue to be processed.
    let result = await classifyCandidates(provider, { userQuery, searchPlan }, batchRepresentatives);

    if (!result.ok) {
      result = await classifyCandidates(provider, { userQuery, searchPlan }, batchRepresentatives);
    }

    if (result.ok) {
      decisions.push(...result.decisions);
    } else {
      for (const representative of batchRepresentatives) {
        decisions.push({
          domain: representative.domain,
          type: "unknown",
          is_company_website: null,
          matches_search_plan: null,
          reason_code: "llm-unavailable",
          evidence: "",
        });
      }
    }
  }

  const decisionByDomain = new Map(
    decisions.map((decision) => [
      String(decision.domain || "").toLowerCase(),
      decision,
    ]),
  );

  const approved = [];
  const llmRejected = [];
  const review = [];

  for (const domainCandidates of domainGroups.values()) {
    const decision = decisionByDomain.get(String(domainCandidates[0].domain).toLowerCase());

    const relevance = decideFromFacts(decision, { providerName, model });

    for (const candidate of domainCandidates) {
      const withRelevance = {
        ...candidate,
        relevance: {
          ...relevance,
          provider: providerName,
          model,
        },
      };

      if (relevance.status === "approved") {
        approved.push(withRelevance);
      } else if (relevance.status === "rejected") {
        llmRejected.push(withRelevance);
      } else {
        review.push(withRelevance);
      }
    }
  }

  return {
    approved,
    rejected: [...rejected, ...llmRejected],
    review,
    provider: providerName,
    model,
    relevanceStatus: "classified",
    decisions,
  };
}
