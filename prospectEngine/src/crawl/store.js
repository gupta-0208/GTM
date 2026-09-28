import crypto from "node:crypto";

import {
  config,
} from "../config.js";

import {
  appendRawPage,
  updateCrawlTarget,
  getCrawlTarget,
} from "../storage/pgStore.js";

import {
  normalizeUrl,
} from "../lib/url.js";

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

export async function storeRawPage({
  request,
  response,
  body,
  sourceType = "website",
  fetchBackend = "plain",
  tier = "cheerio",
}) {
  const loadedUrl =
    request.loadedUrl ||
    request.url;

  const normalized =
    normalizeUrl(
      loadedUrl
    );

  if (!normalized) {
    throw new Error(
      `Cannot normalize fetched URL: ${loadedUrl}`
    );
  }

  const html =
    Buffer.isBuffer(body)
      ? body.toString(
          "utf8"
        )
      : String(body || "");

  const fetchedAt =
    new Date().toISOString();

  const rawPage = {
    url:
      normalized.normalizedUrl,

    url_hash:
      sha256(
        normalized.normalizedUrl
      ),

    domain:
      normalized.domain,

    source_type:
      sourceType,

    fetch_backend:
      fetchBackend,

    status_code:
      response?.statusCode ?? null,

    html,

    content_hash:
      sha256(html),

    fetched_at:
      fetchedAt,

    parse_version:
      null,

    parsed_at:
      null,
  };

  return await appendRawPage(
    rawPage
  );
}

export async function markTargetFetching(
  targetUrl
) {
  await updateCrawlTarget(
    targetUrl,
    {
      state: "fetching",
      last_error: null,
    }
  );
}

export async function markTargetDone(
  targetUrl,
  {
    loadedUrl,
    statusCode,
    rawPageId,
  } = {}
) {
  await updateCrawlTarget(
    targetUrl,
    {
      state: "done",
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      last_loaded_url:
        loadedUrl || null,
      last_status_code:
        statusCode || null,
      last_raw_page_id:
        rawPageId || null,
      completed_at:
        new Date().toISOString(),
    }
  );
}

export async function markTargetFailed(
  targetUrl,
  {
    error,
    attemptsUsed = 1,
    blockImmediately = false,
  } = {}
) {
  const message =
    String(error || "Unknown error");

  const now =
    new Date();

  const target =
    await getCrawlTarget(
      targetUrl
    );

  if (!target) {
    return;
  }

  const attempts =
    Number(
      target.attempts || 0
    ) +
    Number(
      attemptsUsed || 1
    );

  const blocked =
    blockImmediately ||
    attempts >=
      config.crawlMaxAttempts;

  const delayMs =
    Math.min(
      config.crawlRetryBackoffBaseMs *
        2 **
          Math.max(
            0,
            attempts - 1
          ),
      config.crawlRetryBackoffMaxMs
    );

  const nextAttemptAt =
    blocked
      ? null
      : new Date(
          now.getTime() +
            delayMs
        ).toISOString();

  await updateCrawlTarget(
    targetUrl,
    {
      state: blocked
        ? "blocked"
        : "failed",

      attempts,

      next_attempt_at:
        nextAttemptAt,

      last_error:
        message,

      failed_at:
        now.toISOString(),
    }
  );
}