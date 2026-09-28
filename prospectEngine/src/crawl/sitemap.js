import { config } from "../config.js";

import { normalizeUrl } from "../lib/url.js";

import {
  inferArchetype,
  isDroppedUrl,
  pathSegmentsOf,
  priorityForTier,
  scoreCandidate,
} from "./linkSelector.js";

export function extractSitemapUrlsFromRobotsTxt(text) {
  const urls = [];

  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(
      /^\s*Sitemap:\s*(\S+)\s*$/i
    );

    if (match) {
      urls.push(match[1].trim());
    }
  }

  return urls;
}

export function extractLocUrlsFromSitemapXml(text) {
  const urls = [];
  const regex =
    /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

  let match;

  while (
    (match = regex.exec(String(text || ""))) !==
    null
  ) {
    urls.push(match[1].trim());
  }

  return urls;
}

export function isSitemapIndex(text) {
  return /<sitemapindex\b/i.test(
    String(text || "")
  );
}

async function fetchText(
  fetchImpl,
  url,
  timeoutMs
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": config.crawlerUserAgent,
        accept: "text/plain, application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverSitemapCandidates({
  baseUrl,
  fetchImpl = globalThis.fetch,
  limit = config.crawlSitemapMaxUrls,
  timeoutMs = config.crawlSitemapTimeoutMs,
}) {
  const origin = new URL(baseUrl).origin;
  const normalizedBase = normalizeUrl(baseUrl);
  const domain =
    normalizedBase?.domain ||
    new URL(baseUrl).hostname;

  const candidates = new Map();

  const sitemapUrls = new Set();

  const robots = await fetchText(
    fetchImpl,
    `${origin}/robots.txt`,
    timeoutMs
  );

  if (robots) {
    for (const url of extractSitemapUrlsFromRobotsTxt(
      robots
    )) {
      sitemapUrls.add(url);
    }
  }

  if (!sitemapUrls.size) {
    sitemapUrls.add(`${origin}/sitemap.xml`);
  }

  const visited = new Set();
  const queue = [...sitemapUrls];

  while (queue.length && candidates.size < limit) {
    const raw = queue.shift();
    const normalized = normalizeUrl(raw);

    if (!normalized) {
      continue;
    }

    if (normalized.domain !== domain) {
      continue;
    }

    const sitemapUrl = normalized.normalizedUrl;

    if (visited.has(sitemapUrl)) {
      continue;
    }

    visited.add(sitemapUrl);

    const xml = await fetchText(
      fetchImpl,
      sitemapUrl,
      timeoutMs
    );

    if (!xml) {
      continue;
    }

    if (isSitemapIndex(xml)) {
      for (const loc of extractLocUrlsFromSitemapXml(
        xml
      )) {
        if (!visited.has(loc)) {
          queue.push(loc);
        }
      }

      continue;
    }

    for (const loc of extractLocUrlsFromSitemapXml(
      xml
    )) {
      const normalizedLoc = normalizeUrl(loc);

      if (!normalizedLoc) {
        continue;
      }

      if (normalizedLoc.domain !== domain) {
        continue;
      }

      const url = normalizedLoc.normalizedUrl;

      if (isDroppedUrl(url)) {
        continue;
      }

      if (candidates.has(url)) {
        continue;
      }

      const inferred = inferArchetype({
        url,
        anchorText: "",
        title: "",
      });

      const score = scoreCandidate({
        depth: 1,
        tier: inferred.tier,
        urlHits: inferred.urlHits,
        textHits: 0,
        titleHits: 0,
        pathSegments: pathSegmentsOf(url),
      });

      candidates.set(url, {
        url,
        anchorText: "",
        archetype: inferred.archetype,
        tier: inferred.tier,
        score,
        priority: priorityForTier(inferred.tier),
        reason: `sitemap: ${inferred.reason}`,
        depth: 1,
      });

      if (candidates.size >= limit) {
        break;
      }
    }
  }

  return [...candidates.values()].sort(
    (a, b) => b.score - a.score
  );
}
