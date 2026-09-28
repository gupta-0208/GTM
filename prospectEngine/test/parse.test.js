import assert from "node:assert/strict";

import { config } from "../src/config.js";

import {
  createProvider,
} from "../src/parse/llm/provider.js";

import {
  ARCHETYPES,
  classify,
} from "../src/parse/archetype.js";

import {
  deterministicExtract,
} from "../src/parse/deterministic/index.js";

import {
  htmlToMarkdown,
  markdownExtract,
} from "../src/parse/markdown.js";

import {
  extractPage,
  parseAndPersist,
  statusForConfidence,
} from "../src/parse/index.js";

import {
  getRawPage,
  getRawPagesForParse,
} from "../src/storage/pgStore.js";

import {
  query,
  closePool,
} from "../src/storage/pg.js";

const RICH_HTML = `
<html><head>
<title>About Us | Acme Solar</title>
<meta property="og:site_name" content="Acme Solar">
<meta name="description" content="Acme Solar is a leading provider of solar panel and renewable energy solutions in India. We implement SAP S/4HANA and ERP software for solar energy companies with cloud and AI capabilities.">
</head><body>
<h1>About Acme Solar</h1>
<p>Acme Solar provides solar panel and renewable energy solutions and SAP ERP software.</p>
</body></html>`;

const SPARSE_HTML = `
<html><head>
<title>Acme Innovations</title>
<meta name="description" content="Acme">
</head><body>
<h1>About Acme Innovations</h1>
<p>Acme Innovations has been delivering quality outcomes to customers across the globe for many years, focusing on innovation and excellence in every engagement we undertake for our valued partners.</p>
</body></html>`;

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

async function main() {
  console.log("config.llmEnabled =", config.llmEnabled);
  console.log("config.llmProvider =", config.llmProvider);
  console.log("config.currentParseVersion =", config.currentParseVersion);
  console.log("");

  const provider = createProvider(config);

  await test("LLM_ENABLED=false yields a disabled provider", () => {
    assert.equal(config.llmEnabled, false);
    assert.equal(provider.name, "disabled");
  });

  await test("classifier: synthetic about page -> about_page", () => {
    assert.equal(classify(RICH_HTML, "https://acmesolar.com/about"), "about_page");
  });

  await test("classifier: team/careers/job URL patterns", () => {
    assert.equal(classify("<html><title>x</title></html>", "https://a.com/team"), "team_page");
    assert.equal(classify("<html><title>x</title></html>", "https://a.com/careers"), "careers_page");
    assert.equal(classify("<html><title>x</title></html>", "https://a.com/jobs/senior-engineer"), "job_posting");
    assert.equal(classify("<html><title>x</title></html>", "https://a.com/pricing"), "pricing_page");
  });

  await test("classifier: stored raw_pages classify to a valid archetype", async () => {
    const pages = await getRawPagesForParse({ parseVersion: 9999, limit: 20 });
    assert.ok(pages.length > 0, "expected stored raw_pages with html");

    for (const page of pages) {
      const archetype = classify(page.html, page.url);
      assert.ok(ARCHETYPES.includes(archetype), `invalid archetype: ${archetype}`);
    }

    console.log(`        classified ${pages.length} stored pages`);
  });

  await test("Tier 1 (deterministic) is sufficient for a rich page", () => {
    const det = deterministicExtract("about_page", RICH_HTML, "https://acmesolar.com/about");
    assert.ok(det, "deterministic should produce a result");
    assert.ok(det.confidence >= 0.8, `expected >=0.8, got ${det.confidence}`);
  });

  await test("Tier 1 executes before Tier 2 (rich page accepted at tier 1)", async () => {
    const result = await extractPage(
      { html: RICH_HTML, url: "https://acmesolar.com/about", content_hash: "rich" },
      { provider }
    );
    assert.equal(result.tier, "deterministic");
  });

  await test("Tier 2 attempted only when Tier 1 is insufficient (sparse page)", async () => {
    const det = deterministicExtract("about_page", SPARSE_HTML, "https://acmeinnovations.com/about");
    assert.ok(det.confidence < 0.8, `tier 1 should be insufficient, got ${det.confidence}`);

    const result = await extractPage(
      { html: SPARSE_HTML, url: "https://acmeinnovations.com/about", content_hash: "sparse" },
      { provider }
    );
    assert.equal(result.tier, "markdown");
  });

  await test("Tier 2 markdown extraction runs", () => {
    const markdown = htmlToMarkdown(SPARSE_HTML);
    const md = markdownExtract("about_page", markdown, "https://acmeinnovations.com/about");
    assert.ok(md);
    assert.ok(md.confidence > 0);
    assert.equal(md.payload.company_name, "Acme Innovations");
  });

  await test("Tier 3 makes zero network calls when LLM_ENABLED=false", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network fetch should not be called when LLM is disabled");
    };

    try {
      const result = await extractPage(
        { html: SPARSE_HTML, url: "https://acmeinnovations.com/about", content_hash: "sparse" },
        { provider }
      );
      assert.equal(result.notAttempted, true);
      assert.equal(result.provider, "disabled");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("confidence < 0.6 maps to review, never pending", () => {
    assert.equal(statusForConfidence(0.5), "review");
    assert.equal(statusForConfidence(0.6), "pending");
    assert.equal(statusForConfidence(null), "review");
  });

  await test("replay parses an already stored raw_page (parse_version/parsed_at)", async () => {
    const pages = await getRawPagesForParse({ parseVersion: 9999, limit: 1 });
    assert.ok(pages.length > 0, "expected a stored raw_page with html");

    const page = pages[0];

    await query(
      `UPDATE raw_pages SET parse_version = NULL, parsed_at = NULL WHERE id = $1`,
      [page.id]
    );

    const before = await getRawPage(page.id);
    assert.equal(before.parse_version, null);

    const result = await parseAndPersist(
      { ...before, html: before.html },
      { provider, version: config.currentParseVersion }
    );

    const after = await getRawPage(page.id);
    assert.equal(after.parse_version, config.currentParseVersion);
    assert.ok(after.parsed_at, "parsed_at should be set");

    console.log(`        page ${page.id} archetype=${result.archetype} tier=${result.tier} persisted=${result.persisted}`);
  });

  await test("raw_records written when a company payload is produced", async () => {
    const pages = await getRawPagesForParse({ parseVersion: 9999, limit: 5 });
    const page = pages.find(
      (p) => classify(p.html, p.url) !== "team_page" &&
        classify(p.html, p.url) !== "careers_page" &&
        classify(p.html, p.url) !== "job_posting"
    );

    if (!page) {
      console.log("        no company-archetype page available; skipping");
      return;
    }

    await query(
      `UPDATE raw_pages SET parse_version = NULL, parsed_at = NULL WHERE id = $1`,
      [page.id]
    );

    const before = await query(`SELECT count(*)::int AS n FROM raw_records`);
    const beforeCount = before.rows[0].n;

    await parseAndPersist(
      await getRawPage(page.id),
      { provider, version: config.currentParseVersion }
    );

    const after = await query(`SELECT count(*)::int AS n FROM raw_records`);
    const afterCount = after.rows[0].n;

    console.log(`        raw_records ${beforeCount} -> ${afterCount}`);
    assert.ok(afterCount > beforeCount, "expected a raw_record to be inserted");
  });

  console.log("");
  const failed = results.filter((r) => !r.ok);
  console.log(`Passed ${results.length - failed.length}/${results.length}`);

  if (failed.length) {
    console.error(`Failed ${failed.length}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Test run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
