import { pool, closePool } from "./pg.js";

const statements = [
  `CREATE TABLE IF NOT EXISTS raw_pages (
    id BIGSERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    domain TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'website',
    fetch_backend TEXT NOT NULL DEFAULT 'plain',
    status_code INTEGER,
    html TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    parse_version INTEGER,
    parsed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS raw_pages_domain_fetched_idx ON raw_pages(domain, fetched_at DESC)`,
  `CREATE INDEX IF NOT EXISTS raw_pages_parse_idx ON raw_pages(parse_version, fetched_at DESC)`,
  `CREATE TABLE IF NOT EXISTS raw_records (
    id BIGSERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    record_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence DOUBLE PRECISION,
    page_id BIGINT REFERENCES raw_pages(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    qualification_status TEXT,
    qualification_reasons JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS raw_records_type_created_idx ON raw_records(record_type, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS raw_records_page_idx ON raw_records(page_id)`,
  `ALTER TABLE raw_records ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE raw_records ADD COLUMN IF NOT EXISTS product_id TEXT`,
  `ALTER TABLE raw_records ADD COLUMN IF NOT EXISTS product_name TEXT`,
  `CREATE INDEX IF NOT EXISTS raw_records_product_created_idx ON raw_records(product_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS raw_records_company_search_idx
    ON raw_records USING GIN (
      (setweight(to_tsvector('simple', coalesce(source_ref, '')), 'A') ||
       setweight(to_tsvector('simple', coalesce(payload::text, '')), 'B'))
    ) WHERE record_type = 'company'`,
  `CREATE TABLE IF NOT EXISTS product_sources (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_crawled_at TIMESTAMPTZ,
    last_discovered_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(product_id, source_url)
  )`,
  `CREATE INDEX IF NOT EXISTS product_sources_product_idx ON product_sources(product_id, enabled, id)`,
  `CREATE TABLE IF NOT EXISTS crawl_targets (
    id BIGSERIAL PRIMARY KEY,
    domain TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    priority INTEGER NOT NULL DEFAULT 1,
    source_type TEXT NOT NULL DEFAULT 'website',
    depth INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    discovered_by TEXT NOT NULL DEFAULT 'unknown',
    base_url TEXT,
    parent_url TEXT,
    title TEXT,
    anchor_text TEXT NOT NULL DEFAULT '',
    archetype TEXT NOT NULL DEFAULT 'generic',
    priority_score DOUBLE PRECISION,
    priority_reason TEXT,
    matched_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
    occurrences INTEGER NOT NULL DEFAULT 1,
    product_id TEXT,
    product_name TEXT,
    last_error TEXT,
    last_loaded_url TEXT,
    last_status_code INTEGER,
    last_raw_page_id BIGINT REFERENCES raw_pages(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE crawl_targets ADD COLUMN IF NOT EXISTS product_id TEXT`,
  `ALTER TABLE crawl_targets ADD COLUMN IF NOT EXISTS product_name TEXT`,
  `CREATE INDEX IF NOT EXISTS crawl_targets_state_idx ON crawl_targets(state, priority, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS crawl_targets_domain_idx ON crawl_targets(domain)`,
  `CREATE TABLE IF NOT EXISTS crawl_suppressions (
    domain TEXT PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT true,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  console.log(`Database schema ready (${statements.length} statements).`);
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
