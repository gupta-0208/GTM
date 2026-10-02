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
  finder: "finder",
  sourceHarvest: "source-harvest",
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
    // BullMQ custom job IDs cannot contain the colon delimiter.
    { jobId: `discovery-${queryJobId(query)}` }
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

export async function enqueueFinder(query, icp = null, { queue } = {}) {
  assertRedisEnabled();

  const q = queue ?? createQueue(QUEUES.finder);
  const runId = crypto.randomUUID();
  return q.add("finder", { query: String(query || "").trim(), icp }, {
    jobId: `finder-${runId}`,
  });
}

export async function enqueueSourceHarvest(icp, { queue } = {}) {
  assertRedisEnabled();
  const q = queue ?? createQueue(QUEUES.sourceHarvest);
  return q.add("harvest-sources", { icp }, { jobId: `source-harvest-${crypto.randomUUID()}` });
}

export async function getJobStatus(jobId) {
  for (const name of Object.values(QUEUES)) {
    const queue = createQueue(name);
    try {
      const job = await queue.getJob(jobId);

      if (job) {
        const state = await job.getState();
        return {
          id: job.id,
          name: job.name,
          queue: name,
          state,
          progress: job.progress,
          attemptsMade: job.attemptsMade,
          data: job.data,
          result: state === "completed" ? job.returnvalue : null,
          failedReason: job.failedReason,
        };
      }
    } finally {
      await queue.close();
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
  async finder(job) {
    const { runFinder } = await import("../finder.js");
    return runFinder(job.data?.query, job.data?.icp, job);
  },
  [QUEUES.sourceHarvest]: async (job) => {
    const { harvestProductSources } = await import("../sources/public/index.js");
    return harvestProductSources(job.data?.icp, job);
  },
};

export function startWorker({
  queues = [QUEUES.discovery, QUEUES.crawl, QUEUES.extraction, QUEUES.finder, QUEUES.sourceHarvest],
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
