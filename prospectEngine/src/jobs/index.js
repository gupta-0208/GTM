import crypto from "node:crypto";

import { config } from "../config.js";

import { logger } from "../lib/logger.js";

import { discover } from "../discovery/discoveryService.js";
import { crawlTargets } from "../crawl/crawlers.js";
import { runExtraction } from "../pipeline.js";

import { getCrawlTargets } from "../storage/pgStore.js";

import {
  createQueue,
  createWorker,
} from "./queue.js";

export const QUEUES = {
  discovery: "discovery",
  crawl: "crawl",
  extraction: "extraction",
};

function queryJobId(query) {
  return crypto
    .createHash("sha256")
    .update(String(query || "").trim())
    .digest("hex")
    .slice(0, 32);
}

function assertRedisEnabled() {
  if (!config.redisEnabled) {
    throw new Error(
      "job queue is disabled (set REDIS_ENABLED=true)"
    );
  }
}

export async function enqueueDiscovery(
  query,
  { queue } = {}
) {
  assertRedisEnabled();

  const q = queue ?? createQueue(QUEUES.discovery);

  return q.add(
    "discover",
    { query: String(query || "").trim() },
    { jobId: `discovery:${queryJobId(query)}` }
  );
}

export async function enqueueCrawl(
  { queue } = {}
) {
  assertRedisEnabled();

  const q = queue ?? createQueue(QUEUES.crawl);

  return q.add("crawl", {});
}

export async function enqueueExtraction(
  { queue } = {}
) {
  assertRedisEnabled();

  const q = queue ?? createQueue(QUEUES.extraction);

  return q.add("extract", {
    version: config.currentParseVersion,
  });
}

export async function getJobStatus(jobId) {
  for (const name of Object.values(QUEUES)) {
    const queue = createQueue(name);

    const job = await queue.getJob(jobId);

    if (job) {
      return {
        id: job.id,
        name: job.name,
        queue: name,
        state: await job.getState(),
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        data: job.data,
        failedReason: job.failedReason,
      };
    }
  }

  return null;
}

// Worker processors are thin wrappers around existing services; no business
// logic is duplicated here.
export const processors = {
  async discovery(job) {
    logger.info("discovery job started", {
      jobId: job.id,
      query: job.data?.query,
    });

    return discover(job.data?.query);
  },

  async crawl(job) {
    logger.info("crawl job started", {
      jobId: job.id,
    });

    const targets = await getCrawlTargets();

    const queued = targets.filter(
      (target) => target.state === "queued"
    );

    return crawlTargets(
      queued.length ? queued : targets
    );
  },

  async extraction(job) {
    logger.info("extraction job started", {
      jobId: job.id,
    });

    return runExtraction({
      version: job.data?.version ?? config.currentParseVersion,
    });
  },
};

export function startWorker({
  queues = [QUEUES.discovery, QUEUES.crawl, QUEUES.extraction],
} = {}) {
  const workers = [];

  for (const name of queues) {
    const worker = createWorker(
      name,
      processors[name],
      { concurrency: 5 }
    );

    worker.on("completed", (job) => {
      logger.info("job completed", {
        queue: name,
        jobId: job.id,
      });
    });

    worker.on("failed", (job, error) => {
      logger.error("job failed", {
        queue: name,
        jobId: job?.id,
        error: error?.message,
        category: "job_failure",
      });
    });

    worker.on("error", (error) => {
      logger.error("worker error", {
        queue: name,
        error: error?.message,
        category: "worker_error",
      });
    });

    workers.push(worker);
  }

  async function close() {
    await Promise.all(
      workers.map((worker) => worker.close())
    );
  }

  return { workers, close };
}
