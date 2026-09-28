import http from "node:http";

import { config } from "../config.js";

import { logger } from "../lib/logger.js";

import {
  health,
  readiness,
} from "../health.js";

import {
  enqueueDiscovery,
  enqueueCrawl,
  enqueueExtraction,
  getJobStatus,
} from "../jobs/index.js";

const MAX_BODY_BYTES = 1_000_000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;

      if (data.length > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function validateQuery(body) {
  const query = String(
    body?.query ?? ""
  ).trim();

  if (!query) {
    return {
      valid: false,
      error: "query is required and must be a non-empty string",
    };
  }

  return { valid: true, query };
}

export function createHandler({
  enqueueDiscoveryFn = enqueueDiscovery,
  enqueueCrawlFn = enqueueCrawl,
  enqueueExtractionFn = enqueueExtraction,
  getJobFn = getJobStatus,
} = {}) {
  return async function handler(req, res) {
    const requestId =
      req.headers["x-request-id"] ||
      `req-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    res.setHeader("x-request-id", requestId);

    const log = logger.child({
      requestId,
      method: req.method,
      url: req.url,
    });

    const { pathname } = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    try {
      if (req.method === "GET" && pathname === "/health") {
        return sendJson(res, 200, health());
      }

      if (req.method === "GET" && pathname === "/ready") {
        const result = await readiness();

        return sendJson(
          res,
          result.ok ? 200 : 503,
          result
        );
      }

      if (req.method === "POST" && pathname === "/discover") {
        const body = await readJsonBody(req);
        const validation = validateQuery(body);

        if (!validation.valid) {
          return sendJson(res, 400, {
            error: validation.error,
          });
        }

        const job = await enqueueDiscoveryFn(
          validation.query
        );

        return sendJson(res, 202, {
          jobId: job.id,
          queue: "discovery",
        });
      }

      if (req.method === "POST" && pathname === "/crawl") {
        const job = await enqueueCrawlFn();

        return sendJson(res, 202, {
          jobId: job.id,
          queue: "crawl",
        });
      }

      if (req.method === "POST" && pathname === "/extract") {
        const job = await enqueueExtractionFn();

        return sendJson(res, 202, {
          jobId: job.id,
          queue: "extraction",
        });
      }

      const jobMatch = pathname.match(
        /^\/jobs\/([^/]+)$/
      );

      if (req.method === "GET" && jobMatch) {
        const job = await getJobFn(jobMatch[1]);

        if (!job) {
          return sendJson(res, 404, {
            error: "job not found",
          });
        }

        return sendJson(res, 200, job);
      }

      return sendJson(res, 404, {
        error: "not found",
      });
    } catch (error) {
      log.error("request failed", {
        error: error.message,
      });

      const status =
        error?.message === "request body too large" ||
        error?.message === "invalid JSON body"
          ? 400
          : 503;

      return sendJson(res, status, {
        error:
          status === 400
            ? error.message
            : "service unavailable",
      });
    }
  };
}

export function createServer(deps) {
  return http.createServer(createHandler(deps));
}

export function startServer(deps) {
  const server = createServer(deps);

  server.listen(config.port, () => {
    logger.info("api listening", {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });
  });

  return server;
}
