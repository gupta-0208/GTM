import http from "node:http";

import { config } from "../config.js";

import { logger } from "../lib/logger.js";

import {
  health,
  readiness,
} from "../health.js";

import {
  enqueueFinder,
  enqueueDiscovery,
  enqueueCrawl,
  enqueueExtraction,
  getJobStatus,
  enqueueSourceHarvest,
} from "../jobs/index.js";
import { query as dbQuery } from "../storage/pg.js";
import { searchCompanyIndex, listProductSources, addProductSource, deleteProductSource, getEnabledProductSources } from "../storage/pgStore.js";
import { diagnoseSearch } from "../channels/search.js";

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

function validateIcpProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = String(raw.name || "").trim();
  const idealCustomer = String(raw.ideal_customer || "").trim();
  const companyTypes = Array.isArray(raw.company_types)
    ? raw.company_types.map((value) => String(value).trim()).filter(Boolean)
    : String(raw.company_types || "").split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
  if (!name || !idealCustomer || !companyTypes.length) return null;
  return {
    ...raw,
    id: String(raw.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 100),
    name: name.slice(0, 120),
    ideal_customer: idealCustomer.slice(0, 3000),
    company_types: companyTypes.slice(0, 30),
    industries: Array.isArray(raw.industries) ? raw.industries.slice(0, 30) : [],
  };
}

function validatePublicSourceUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function createHandler({
  enqueueDiscoveryFn = enqueueDiscovery,
  enqueueCrawlFn = enqueueCrawl,
  enqueueExtractionFn = enqueueExtraction,
  getJobFn = getJobStatus,
  enqueueFinderFn = enqueueFinder,
  getDashboardFn = getDashboardData,
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

      if (req.method === "GET" && pathname === "/dashboard") {
        return sendJson(res, 200, await getDashboardFn());
      }

      if (req.method === "GET" && pathname === "/index/search") {
        const params = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams;
        const searchQuery = params.get("query")?.trim() || "";
        const productId = params.get("product_id")?.trim() || null;
        const limit = Number(params.get("limit") || 50);
        if (searchQuery.length < 2) {
          return sendJson(res, 400, { error: "query must be at least 2 characters" });
        }
        if (searchQuery.length > 300 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
          return sendJson(res, 400, { error: "query must be at most 300 characters and limit must be 1–100" });
        }
        const records = await searchCompanyIndex({ query: searchQuery, productId, limit });
        return sendJson(res, 200, { query: searchQuery, productId, count: records.length, records });
      }

      if (req.method === "GET" && pathname === "/index/sources") {
        const productId = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("product_id")?.trim();
        if (!productId || productId.length > 120) return sendJson(res, 400, { error: "product_id is required" });
        return sendJson(res, 200, { sources: await listProductSources(productId) });
      }

      if (req.method === "POST" && pathname === "/index/sources") {
        const body = await readJsonBody(req);
        const productId = String(body.product_id || "").trim();
        const productName = String(body.product_name || "").trim();
        const sourceUrl = validatePublicSourceUrl(body.source_url);
        if (!productId || productId.length > 120 || !productName || productName.length > 120 || !sourceUrl) {
          return sendJson(res, 400, { error: "product_id, product_name, and a public http(s) source_url are required" });
        }
        const source = await addProductSource({ productId, productName, sourceUrl });
        return sendJson(res, 201, { source });
      }

      if (req.method === "DELETE" && pathname.startsWith("/index/sources/")) {
        const sourceId = Number(pathname.slice("/index/sources/".length));
        const productId = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("product_id")?.trim();
        if (!Number.isSafeInteger(sourceId) || sourceId < 1 || !productId) return sendJson(res, 400, { error: "valid source id and product_id are required" });
        const deleted = await deleteProductSource({ sourceId, productId });
        return sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "source not found" });
      }

      if (req.method === "POST" && pathname === "/index/harvest") {
        const body = await readJsonBody(req);
        const icp = validateIcpProfile(body?.icp);
        if (!icp) return sendJson(res, 400, { error: "icp must include product name, ideal_customer, and at least one company_type" });
        const sources = await getEnabledProductSources(icp.id);
        if (!sources.length) return sendJson(res, 409, { error: `Add a public source URL for ${icp.name} first` });
        const job = await enqueueSourceHarvest(icp);
        return sendJson(res, 202, { jobId: job.id, queue: "source-harvest" });
      }

      if (req.method === "GET" && pathname === "/search/diagnostic") {
        const searchQuery = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("query")?.trim();
        if (!searchQuery) {
          return sendJson(res, 400, { error: "query is required" });
        }
        if (searchQuery.length > 500) {
          return sendJson(res, 400, { error: "query must be 500 characters or less" });
        }
        return sendJson(res, 200, await diagnoseSearch(searchQuery));
      }

      if (req.method === "POST" && pathname === "/finder") {
        const body = await readJsonBody(req);
        const validation = validateQuery(body);

        if (!validation.valid) {
          return sendJson(res, 400, { error: validation.error });
        }

        const icp = validateIcpProfile(body?.icp);
        if (!icp) {
          return sendJson(res, 400, { error: "icp must include product name, ideal_customer, and at least one company_type" });
        }

        const job = await enqueueFinderFn(validation.query, icp);
        return sendJson(res, 202, { jobId: job.id, queue: "finder" });
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

async function getDashboardData() {
  const [summary, records, targets, recentTargets] = await Promise.all([
    dbQuery(`
      WITH normalized AS (
        SELECT r.*,
          regexp_replace(
            lower(split_part(regexp_replace(r.source_ref, '^https?://', '', 'i'), '/', 1)),
            '^www\\.', ''
          ) AS domain_key
        FROM raw_records r
        WHERE r.record_type = 'company'
      ), ranked AS (
        SELECT normalized.*,
          row_number() OVER (
            PARTITION BY coalesce(product_id, ''), domain_key
            ORDER BY CASE qualification_status
              WHEN 'qualified' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
              confidence DESC NULLS LAST,
              length(coalesce(payload->>'company_description', '')) DESC,
              created_at DESC, id DESC
          ) AS domain_rank
        FROM normalized
      ), deduped AS (
        SELECT * FROM ranked WHERE domain_rank = 1
      )
      SELECT
        count(*)::int AS companies,
        (SELECT count(*)::int FROM raw_records WHERE record_type = 'contact') AS contacts,
        count(*) FILTER (WHERE qualification_status = 'qualified')::int AS qualified,
        count(*) FILTER (WHERE qualification_status = 'review')::int AS review,
        count(*) FILTER (WHERE qualification_status = 'not_qualified')::int AS not_qualified
      FROM deduped
    `),
    dbQuery(`
      WITH normalized AS (
        SELECT r.*,
          regexp_replace(
            lower(split_part(regexp_replace(r.source_ref, '^https?://', '', 'i'), '/', 1)),
            '^www\\.', ''
          ) AS domain_key
        FROM raw_records r
        WHERE r.record_type = 'company'
      ), ranked AS (
        SELECT normalized.*,
          row_number() OVER (
            PARTITION BY coalesce(product_id, ''), domain_key
            ORDER BY CASE qualification_status
              WHEN 'qualified' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
              confidence DESC NULLS LAST,
              length(coalesce(payload->>'company_description', '')) DESC,
              created_at DESC, id DESC
          ) AS domain_rank
        FROM normalized
      ), visible AS (
        SELECT id, record_type, source_ref, payload, confidence, status,
               qualification_status, qualification_reasons, created_at,
               run_id, product_id, product_name
        FROM ranked WHERE domain_rank = 1
        UNION ALL
        SELECT id, record_type, source_ref, payload, confidence, status,
               qualification_status, qualification_reasons, created_at,
               run_id, product_id, product_name
        FROM raw_records WHERE record_type = 'contact'
      )
      SELECT * FROM visible ORDER BY created_at DESC, id DESC LIMIT 100
    `),
    dbQuery(`
      SELECT state, count(*)::int AS count
      FROM crawl_targets
      GROUP BY state
    `),
    dbQuery(`
      SELECT domain, url, title, state, last_status_code, last_error, updated_at
      FROM crawl_targets
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
    `),
  ]);

  return {
    summary: summary.rows[0],
    records: records.rows,
    targets: Object.fromEntries(targets.rows.map((row) => [row.state, row.count])),
    recentTargets: recentTargets.rows,
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
