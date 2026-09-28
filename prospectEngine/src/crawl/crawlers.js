import {
  CheerioCrawler,
} from "crawlee";

import {
  config,
} from "../config.js";

import {
  isSuppressed,
  upsertCrawlTargets,
} from "../storage/pgStore.js";

import {
  normalizeUrl,
} from "../lib/url.js";

import {
  discoverPageCandidates,
  candidateToTarget,
} from "./linkSelector.js";

import {
  discoverSitemapCandidates,
} from "./sitemap.js";

import {
  storeRawPage,
  markTargetFetching,
  markTargetDone,
  markTargetFailed,
} from "./store.js";

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function retryBackoffMs(
  retryCount
) {
  if (
    retryCount <= 0
  ) {
    return 0;
  }

  const base = Math.min(
    config.crawlRetryBackoffBaseMs *
      2 **
        (retryCount - 1),
    config.crawlRetryBackoffMaxMs
  );

  // Full jitter avoids synchronized retry storms across domains.
  return Math.floor(
    base / 2 + Math.random() * (base / 2)
  );
}

function getDomain(url) {
  const normalized =
    normalizeUrl(url);

  return (
    normalized?.domain ||
    new URL(url).hostname
  );
}

async function persistDiscoveryCandidates(
  candidates,
  {
    baseUrl,
    parentUrl,
    sourceType,
    discoveredBy = "internal-link",
  }
) {
  if (!candidates.length) {
    return;
  }

  const targets = candidates.map(
    (candidate) =>
      candidateToTarget(candidate, {
        baseUrl,
        parentUrl,
        sourceType,
        discoveredBy,
      })
  );

  await upsertCrawlTargets(targets);
}

export async function crawlTargets(
  targets
) {
  const selected =
    targets.slice(
      0,
      config.crawlMaxCandidates
    );

  if (!selected.length) {
    return {
      targetsSelected: 0,
      pagesStored: 0,
      targetsDone: 0,
      targetsFailed: 0,
      targetsBlocked: 0,
    };
  }

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "DAY 2 — CRAWLING"
  );
  console.log(
    "========================================"
  );

  console.log(
    `Crawling ${selected.length} candidate domains`
  );

  const metrics = {
    targetsSelected:
      selected.length,

    pagesStored: 0,

    targetsDone: 0,

    targetsFailed: 0,

    targetsBlocked: 0,
  };

  const crawler =
    new CheerioCrawler({
      maxRequestsPerCrawl:
        selected.length *
        config.crawlMaxPagesPerDomain,

      maxConcurrency:
        config.crawlMaxConcurrency,

      maxRequestsPerMinute:
        config.crawlMaxRequestsPerMinute,

      maxRequestRetries:
        config.crawlMaxRetries,

      requestHandlerTimeoutSecs:
        config.crawlRequestTimeoutSecs,

      respectRobotsTxtFile:
        true,

      retryOnBlocked:
        false,

      sameDomainDelaySecs:
        config.crawlSameDomainDelaySecs,

      preNavigationHooks: [
        async ({
          request,
        }) => {
          const retryCount =
            Number(
              request.retryCount || 0
            );

          const wait =
            retryBackoffMs(
              retryCount
            );

          if (wait > 0) {
            console.log(
              `Retry backoff ${wait}ms: ${request.url}`
            );

            await sleep(wait);
          }

          const domain =
            getDomain(
              request.url
            );

          const suppressed =
            await isSuppressed({
              domain,
            });

          if (
            suppressed
          ) {
            request.userData.suppressed =
              true;

            request.userData.seedTarget =
              false;

            request.noRetry =
              true;

            throw new Error(
              `Fetch suppressed for domain: ${domain}`
            );
          }

          if (
            request.userData
              ?.seedTarget
          ) {
            await markTargetFetching(
              request.userData
                .targetUrl
            );
          }
        },
      ],

      postNavigationHooks: [
        async ({
          request,
          response,
        }) => {
          const status =
            response?.statusCode;

          request.userData.lastStatus =
            status;

          if (
            status === 429 ||
            status === 503 ||
            status === 403
          ) {
            request.userData.blockAfterFailure =
              true;

            request.noRetry =
              true;

            const wait =
              retryBackoffMs(
                Number(
                  request.retryCount || 0
                ) + 1
              );

            if (wait > 0) {
              console.log(
                `HTTP ${status}. Backing off ${wait}ms: ${request.url}`
              );

              await sleep(wait);
            }

            throw new Error(
              `HTTP ${status} from ${request.url}`
            );
          }
        },
      ],

      async requestHandler({
        request,
        response,
        body,
        $,
        addRequests,
        log,
      }) {
        log.info(
          `Fetched: ${request.url}`
        );

        const contentType = String(
          response?.headers?.["content-type"] ||
            response?.contentType ||
            ""
        ).toLowerCase();

        if (
          contentType &&
          !contentType.includes("text/html") &&
          !contentType.includes("text/plain") &&
          !contentType.includes("application/xhtml")
        ) {
          log.info(
            `Skipping non-HTML content (${contentType}): ${request.url}`
          );

          return;
        }

        const bodyBytes = Buffer.isBuffer(body)
          ? body.length
          : Buffer.byteLength(
              String(body || ""),
              "utf8"
            );

        if (
          bodyBytes >
          config.crawlMaxResponseBytes
        ) {
          log.info(
            `Skipping oversized response (${bodyBytes} bytes): ${request.url}`
          );

          if (
            request.userData
              ?.seedTarget
          ) {
            await markTargetDone(
              request.userData
                .targetUrl,
              {
                loadedUrl:
                  request.loadedUrl ||
                  request.url,

                statusCode:
                  response?.statusCode ??
                  null,

                rawPageId: null,
              }
            );

            metrics.targetsDone += 1;
          }

          return;
        }

        const rawPage =
          await storeRawPage({
            request,
            response,
            body,
            sourceType:
              request.userData
                ?.sourceType ||
              "website",
            fetchBackend:
              "plain",
            tier:
              "cheerio",
          });

        metrics.pagesStored += 1;

        if (
          request.userData
            ?.seedTarget
        ) {
          await markTargetDone(
            request.userData
              .targetUrl,
            {
              loadedUrl:
                request.loadedUrl ||
                request.url,

              statusCode:
                response?.statusCode ??
                null,

              rawPageId:
                rawPage.id,
            }
          );

          metrics.targetsDone += 1;
        }

        const depth =
          Number(
            request.userData
              ?.depth || 0
          );

        if (
          depth >=
          config.crawlMaxDepth
        ) {
          return;
        }

        const baseUrl =
          request.userData
            ?.baseUrl ||
          request.url;

        const loadedUrl =
          request.loadedUrl ||
          request.url;

        const sourceType =
          request.userData
            ?.sourceType ||
          "website";

        const title =
          $("title")
            .first()
            .text()
            .trim();

        const candidates =
          discoverPageCandidates({
            $,
            currentUrl: loadedUrl,
            baseUrl,
            title,
            depth,
          });

        if (candidates.length) {
          await persistDiscoveryCandidates(
            candidates,
            {
              baseUrl,
              parentUrl: loadedUrl,
              sourceType,
              discoveredBy: "internal-link",
            }
          );
        }

        let toFetch = candidates;

        if (
          request.userData
            ?.seedTarget &&
          depth === 0 &&
          config.crawlSitemapEnabled
        ) {
          try {
            const sitemap =
              await discoverSitemapCandidates({
                baseUrl,
              });

            if (sitemap.length) {
              await persistDiscoveryCandidates(
                sitemap,
                {
                  baseUrl,
                  parentUrl: null,
                  sourceType,
                  discoveredBy: "sitemap",
                }
              );

              toFetch = [
                ...toFetch,
                ...sitemap,
              ].sort(
                (a, b) =>
                  b.score - a.score
              );
            }
          } catch (error) {
            log.warning(
              `Sitemap discovery failed for ${baseUrl}: ${error.message}`
            );
          }
        }

        const next = toFetch.slice(
          0,
          config.crawlMaxPagesPerDomain
        );

        if (!next.length) {
          return;
        }

        await addRequests(
          next.map(
            (candidate) => ({
              url: candidate.url,

              userData: {
                seedTarget: false,

                depth:
                  depth + 1,

                baseUrl,

                sourceType,
              },
            })
          )
        );
      },

      async failedRequestHandler({
        request,
        error,
        log,
      }) {
        log.warning(
          `Failed: ${request.url}`
        );

        const seedTarget =
          request.userData
            ?.seedTarget;

        if (!seedTarget) {
          return;
        }

        const attemptsUsed =
          Math.max(
            1,
            Number(
              request.retryCount || 0
            ) + 1
          );

        const blockImmediately =
          Boolean(
            request.userData
              ?.blockAfterFailure
          ) ||
          Boolean(
            request.userData
              ?.suppressed
          );

        await markTargetFailed(
          request.userData
            .targetUrl,
          {
            error:
              error?.message ||
              request.errorMessages?.at(-1) ||
              "Crawler request failed",

            attemptsUsed,

            blockImmediately,
          }
        );

        if (blockImmediately) {
          metrics.targetsBlocked += 1;
        } else {
          metrics.targetsFailed += 1;
        }
      },
    });

  const requests =
    selected.map(
      (target) => ({
        url:
          target.url,

        userData: {
          seedTarget: true,

          targetUrl:
            target.url,

          baseUrl:
            target.baseUrl,

          depth: 0,

          sourceType:
            target.source_type ||
            "website",
        },
      })
    );

  await crawler.run(
    requests
  );

  console.log("");
  console.log(
    "CRAWL SUMMARY"
  );

  console.log(
    `Targets selected: ${metrics.targetsSelected}`
  );

  console.log(
    `Pages stored: ${metrics.pagesStored}`
  );

  console.log(
    `Targets completed: ${metrics.targetsDone}`
  );

  console.log(
    `Targets failed: ${metrics.targetsFailed}`
  );

  console.log(
    `Targets blocked/suppressed: ${metrics.targetsBlocked}`
  );

  return metrics;
}