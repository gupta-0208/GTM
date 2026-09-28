import { parse } from "tldts";

import { config } from "../config.js";

import { normalizeUrl } from "../lib/url.js";

// Semantic page archetypes recognised during discovery. Keywords are matched
// against the URL path, anchor text and (when available) the page title, so
// unusual slugs such as /our-people or /leadership-team still map correctly.
export const ARCHETYPE_KEYWORDS = {
  about: [
    "about",
    "about-us",
    "about-the-company",
    "company",
    "our-story",
    "who-we-are",
    "overview",
  ],
  team: [
    "team",
    "people",
    "our-team",
    "our-people",
    "meet-the-team",
  ],
  leadership: [
    "leadership",
    "leadership-team",
    "management",
    "executive-team",
    "executives",
  ],
  founders: [
    "founder",
    "founders",
    "founding-team",
  ],
  contact: [
    "contact",
    "contact-us",
    "get-in-touch",
  ],
  careers: [
    "careers",
    "jobs",
    "job",
    "opportunities",
    "work-with-us",
    "join-us",
    "openings",
    "vacancies",
  ],
  pricing: [
    "pricing",
    "plans",
    "price",
  ],
  blog: [
    "blog",
    "articles",
    "news",
    "insights",
    "resources",
  ],
  press: [
    "press",
    "media",
    "newsroom",
    "press-releases",
  ],
  product: [
    "product",
    "products",
    "solution",
    "solutions",
    "services",
  ],
};

// Low-value pages are still recognised (so they can be ranked last) rather
// than silently treated as unknown.
export const LOW_PRIORITY_KEYWORDS = {
  privacy: ["privacy", "privacy-policy"],
  terms: [
    "terms",
    "terms-of-service",
    "terms-and-conditions",
    "tos",
  ],
  cookie: ["cookie", "cookies", "cookie-policy"],
  login: [
    "login",
    "log-in",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "register",
    "logout",
  ],
  legal: [
    "legal",
    "disclaimer",
    "gdpr",
    "compliance",
  ],
  archives: ["archive", "archives"],
};

const HIGH_PRIORITY = new Set([
  "about",
  "team",
  "leadership",
  "founders",
  "contact",
  "careers",
]);

const MEDIUM_PRIORITY = new Set([
  "pricing",
  "blog",
  "press",
  "product",
]);

const LOW_PRIORITY = new Set(
  Object.keys(LOW_PRIORITY_KEYWORDS)
);

const TIER_RANK = {
  high: 1,
  medium: 2,
  low: 3,
  generic: 4,
};

// Specific categories win over generic ones. When a URL matches several
// archetypes, this precedence decides which one is reported. Ordered from
// most specific to least specific.
const ARCHETYPE_PRECEDENCE = {
  founders: 90,
  leadership: 80,
  team: 70,
  about: 60,
  contact: 50,
  careers: 40,
  pricing: 30,
  product: 25,
  blog: 20,
  press: 20,
  privacy: 10,
  terms: 10,
  cookie: 10,
  login: 10,
  legal: 10,
  archives: 10,
  generic: -1,
};

const URL_HIT_BONUS = 4;
const ANCHOR_HIT_BONUS = 12;
const TITLE_HIT_BONUS = 8;
const DEPTH_PENALTY = 5;
const SEGMENT_PENALTY = 3;

const EXCLUDED_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|avif|bmp|tif|tiff|css|js|map|json|xml|woff2?|ttf|eot|otf|mp3|mp4|webm|ogg|zip|rar|7z|gz|tar|bz2|pdf|docx?|xlsx?|pptx?|ppt|epub|csv)$/i;

const PAGINATION_PATH =
  /\/(page|p)\/\d+/i;

const PAGINATION_QUERY =
  /[?&](page|p|paged|start|offset|from|limit)=\d+/i;

const USELESS_BRANCH =
  /\/(wp-admin|wp-login|wp-content|wp-includes|api|cdn|static|assets|uploads|feed|rss|comments|tag|tags|author|category)\//i;

const USELESS_PAGE =
  /\/(cart|checkout|account|my-account|basket|wishlist|admin|wp-login)\/?$/i;

function escapeRegex(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function keywordRegex(keyword) {
  return new RegExp(
    `\\b${escapeRegex(keyword)}\\b`,
    "i"
  );
}

export function tierFor(archetype) {
  if (HIGH_PRIORITY.has(archetype)) {
    return "high";
  }

  if (MEDIUM_PRIORITY.has(archetype)) {
    return "medium";
  }

  if (LOW_PRIORITY.has(archetype)) {
    return "low";
  }

  return "generic";
}

export function priorityForTier(tier) {
  return TIER_RANK[tier] ?? TIER_RANK.generic;
}

export function precedenceOf(archetype) {
  return (
    ARCHETYPE_PRECEDENCE[archetype] ??
    ARCHETYPE_PRECEDENCE.generic
  );
}

function tierScore(tier) {
  switch (tier) {
    case "high":
      return config.discoveryHighPriorityScore;
    case "medium":
      return config.discoveryMediumPriorityScore;
    case "low":
      return config.discoveryLowPriorityScore;
    default:
      return config.discoveryGenericScore;
  }
}

function matchArchetype({
  urlPath,
  anchorText,
  title,
  archetype,
  keywords,
}) {
  let urlHits = 0;
  let textHits = 0;
  let titleHits = 0;

  let bestKeyword = "";
  let bestKeywordLength = 0;

  for (const keyword of keywords) {
    const regex = keywordRegex(keyword);

    const matchedUrl = regex.test(urlPath);
    const matchedAnchor = anchorText
      ? regex.test(anchorText)
      : false;
    const matchedTitle = title
      ? regex.test(title)
      : false;

    if (matchedUrl) {
      urlHits += 1;
    }

    if (matchedAnchor) {
      textHits += 1;
    }

    if (matchedTitle) {
      titleHits += 1;
    }

    if (
      (matchedUrl || matchedAnchor || matchedTitle) &&
      keyword.length > bestKeywordLength
    ) {
      bestKeyword = keyword;
      bestKeywordLength = keyword.length;
    }
  }

  if (urlHits || textHits || titleHits) {
    return {
      archetype,
      tier: tierFor(archetype),
      urlHits,
      textHits,
      titleHits,
      bestKeyword,
      bestKeywordLength,
    };
  }

  return null;
}

function buildReason({
  archetype,
  bestKeyword,
  urlHits,
  textHits,
  titleHits,
}) {
  const sources = [];

  if (urlHits) {
    sources.push("url");
  }

  if (textHits) {
    sources.push("anchor");
  }

  if (titleHits) {
    sources.push("title");
  }

  return `${archetype}: keyword '${bestKeyword}' matched in ${sources.join("+")}`;
}

export function inferArchetype({
  url,
  anchorText = "",
  title = "",
}) {
  let urlPath = "";

  try {
    urlPath = new URL(url).pathname.toLowerCase();
  } catch {
    // Fall through; unmatched URLs resolve to generic.
  }

  const lowerAnchor = String(anchorText || "")
    .toLowerCase();
  const lowerTitle = String(title || "")
    .toLowerCase();

  const matches = [];

  for (const [archetype, keywords] of Object.entries(
    ARCHETYPE_KEYWORDS
  )) {
    const match = matchArchetype({
      urlPath,
      anchorText: lowerAnchor,
      title: lowerTitle,
      archetype,
      keywords,
    });

    if (match) {
      matches.push(match);
    }
  }

  for (const [archetype, keywords] of Object.entries(
    LOW_PRIORITY_KEYWORDS
  )) {
    const match = matchArchetype({
      urlPath,
      anchorText: lowerAnchor,
      title: lowerTitle,
      archetype,
      keywords,
    });

    if (match) {
      matches.push(match);
    }
  }

  if (!matches.length) {
    return {
      archetype: "generic",
      tier: "generic",
      reason: "no semantic keyword matched",
      urlHits: 0,
      textHits: 0,
      titleHits: 0,
      bestKeyword: "",
      bestKeywordLength: 0,
    };
  }

  matches.sort(
    (a, b) =>
      precedenceOf(b.archetype) -
        precedenceOf(a.archetype) ||
      b.bestKeywordLength -
        a.bestKeywordLength ||
      b.urlHits - a.urlHits ||
      b.textHits - a.textHits
  );

  const best = matches[0];

  return {
    archetype: best.archetype,
    tier: best.tier,
    reason: buildReason(best),
    urlHits: best.urlHits,
    textHits: best.textHits,
    titleHits: best.titleHits,
    bestKeyword: best.bestKeyword,
    bestKeywordLength: best.bestKeywordLength,
  };
}

export function scoreCandidate({
  depth = 0,
  tier = "generic",
  urlHits = 0,
  textHits = 0,
  titleHits = 0,
  pathSegments = 0,
}) {
  let score = tierScore(tier);

  score += urlHits * URL_HIT_BONUS;
  score += textHits * ANCHOR_HIT_BONUS;
  score += titleHits * TITLE_HIT_BONUS;
  score -= (Number(depth) || 0) * DEPTH_PENALTY;
  score -= Math.max(0, pathSegments - 2) * SEGMENT_PENALTY;

  return score;
}

export function isDroppedUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const path = parsed.pathname.toLowerCase();

  if (EXCLUDED_EXTENSIONS.test(path)) {
    return true;
  }

  if (PAGINATION_PATH.test(path)) {
    return true;
  }

  if (USELESS_BRANCH.test(path)) {
    return true;
  }

  if (USELESS_PAGE.test(path)) {
    return true;
  }

  if (parsed.search && PAGINATION_QUERY.test(parsed.search)) {
    return true;
  }

  return false;
}

export function pathSegmentsOf(url) {
  try {
    return new URL(url).pathname
      .split("/")
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function discoverPageCandidates({
  $,
  currentUrl,
  baseUrl,
  title = "",
  depth = 0,
  limit = config.crawlDiscoveryMaxLinksPerPage,
}) {
  const base = new URL(baseUrl);
  const current = new URL(currentUrl);

  const baseDomain =
    parse(base.hostname).domain ||
    base.hostname;

  const links = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) {
      return;
    }

    const trimmed = href.trim();

    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("javascript:")
    ) {
      return;
    }

    let absolute;

    try {
      absolute = new URL(trimmed, current);
    } catch {
      return;
    }

    if (
      absolute.protocol !== "http:" &&
      absolute.protocol !== "https:"
    ) {
      return;
    }

    const domain =
      parse(absolute.hostname).domain ||
      absolute.hostname;

    if (domain !== baseDomain) {
      return;
    }

    const normalized = normalizeUrl(
      absolute.toString()
    );

    if (!normalized) {
      return;
    }

    const path = new URL(
      normalized.normalizedUrl
    ).pathname;

    if (path === "" || path === "/") {
      return;
    }

    if (isDroppedUrl(normalized.normalizedUrl)) {
      return;
    }

    links.push({
      url: normalized.normalizedUrl,
      anchorText: $(element)
        .text()
        .trim()
        .slice(0, 200),
    });
  });

  const unique = new Map();

  for (const link of links) {
    const existing = unique.get(link.url);

    if (
      !existing ||
      (link.anchorText && !existing.anchorText)
    ) {
      unique.set(link.url, link);
    }
  }

  const candidates = [];

  for (const link of unique.values()) {
    const inferred = inferArchetype({
      url: link.url,
      anchorText: link.anchorText,
      title,
    });

    const score = scoreCandidate({
      depth,
      tier: inferred.tier,
      urlHits: inferred.urlHits,
      textHits: inferred.textHits,
      titleHits: inferred.titleHits,
      pathSegments: pathSegmentsOf(link.url),
    });

    candidates.push({
      url: link.url,
      anchorText: link.anchorText,
      archetype: inferred.archetype,
      tier: inferred.tier,
      score,
      priority: priorityForTier(inferred.tier),
      reason: inferred.reason,
      depth: Number(depth || 0) + 1,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function candidateToTarget(
  candidate,
  {
    baseUrl = null,
    parentUrl = null,
    sourceType = "website",
    discoveredBy = "internal-link",
  } = {}
) {
  const normalized = normalizeUrl(
    candidate.url
  );

  return {
    domain:
      normalized?.domain ||
      new URL(candidate.url).hostname,
    url: candidate.url,
    priority:
      candidate.priority ??
      priorityForTier(candidate.tier),
    source_type: sourceType,
    depth: candidate.depth ?? 0,
    state: "queued",
    attempts: 0,
    next_attempt_at: null,
    discovered_by: discoveredBy,
    baseUrl:
      baseUrl ?? normalized?.baseUrl ?? null,
    parentUrl: parentUrl ?? null,
    title: null,
    anchorText: candidate.anchorText ?? "",
    archetype: candidate.archetype ?? "generic",
    priorityScore: candidate.score ?? null,
    priorityReason: candidate.reason ?? null,
  };
}
