import assert from "node:assert/strict";
import { load } from "cheerio";

import {
  inferArchetype,
  discoverPageCandidates,
  candidateToTarget,
  isDroppedUrl,
} from "../src/crawl/linkSelector.js";

import {
  extractSitemapUrlsFromRobotsTxt,
  extractLocUrlsFromSitemapXml,
  isSitemapIndex,
  discoverSitemapCandidates,
} from "../src/crawl/sitemap.js";

import {
  upsertCrawlTargets,
  getCrawlTarget,
} from "../src/storage/pgStore.js";

import {
  query,
  closePool,
} from "../src/storage/pg.js";

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
  await test("inferArchetype: unusual URL slugs map to semantic types", () => {
    assert.equal(inferArchetype({ url: "https://acmecorp.com/our-people" }).archetype, "team");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/leadership-team" }).archetype, "leadership");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/our-story" }).archetype, "about");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/contact-us" }).archetype, "contact");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/get-in-touch" }).archetype, "contact");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/meet-the-team" }).archetype, "team");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/founding-team" }).archetype, "founders");
  });

  await test("inferArchetype: anchor text + title assist generic URLs", () => {
    const byAnchor = inferArchetype({
      url: "https://acmecorp.com/management",
      anchorText: "Meet our leadership team",
    });
    assert.equal(byAnchor.archetype, "leadership");

    const byTitle = inferArchetype({
      url: "https://acmecorp.com/story",
      title: "About Us",
    });
    assert.equal(byTitle.archetype, "about");
  });

  await test("inferArchetype: low-value pages recognised as low tier", () => {
    assert.equal(inferArchetype({ url: "https://acmecorp.com/privacy" }).tier, "low");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/terms-of-service" }).tier, "low");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/login" }).tier, "low");
    assert.equal(inferArchetype({ url: "https://acmecorp.com/random-page" }).tier, "generic");
  });

  await test("discoverPageCandidates: priority ordering high > medium > low > generic", () => {
    const html = `
      <html><head><title>Acme Corp</title></head><body>
        <a href="/privacy">Privacy</a>
        <a href="/pricing">Pricing</a>
        <a href="/team">Team</a>
        <a href="/mystery">Mystery</a>
      </body></html>`;
    const $ = load(html);
    const candidates = discoverPageCandidates({
      $,
      currentUrl: "https://acmecorp.com/",
      baseUrl: "https://acmecorp.com/",
    });

    const urls = candidates.map((c) => c.url);
    const teamIdx = urls.indexOf("https://acmecorp.com/team");
    const pricingIdx = urls.indexOf("https://acmecorp.com/pricing");
    const privacyIdx = urls.indexOf("https://acmecorp.com/privacy");
    const mysteryIdx = urls.indexOf("https://acmecorp.com/mystery");

    assert.ok(teamIdx !== -1 && pricingIdx !== -1 && privacyIdx !== -1 && mysteryIdx !== -1);
    assert.ok(teamIdx < pricingIdx, "high should sort before medium");
    assert.ok(pricingIdx < privacyIdx, "medium should sort before low");
    assert.ok(privacyIdx < mysteryIdx, "low should sort before generic");
  });

  await test("discoverPageCandidates: deduplicates duplicate URLs", () => {
    const html = `
      <html><head><title>x</title></head><body>
        <a href="/about">About Us</a>
        <a href="/about">Our Company</a>
        <a href="/about?utm_source=newsletter#team">About</a>
      </body></html>`;
    const $ = load(html);
    const candidates = discoverPageCandidates({
      $,
      currentUrl: "https://acmecorp.com/",
      baseUrl: "https://acmecorp.com/",
    });

    const about = candidates.filter((c) => c.url === "https://acmecorp.com/about");
    assert.equal(about.length, 1);
  });

  await test("discoverPageCandidates: filters external domains", () => {
    const html = `
      <html><head><title>x</title></head><body>
        <a href="/about">Internal</a>
        <a href="https://external.com/about">External</a>
        <a href="https://blog.acmecorp.com/team">Subdomain</a>
      </body></html>`;
    const $ = load(html);
    const candidates = discoverPageCandidates({
      $,
      currentUrl: "https://acmecorp.com/",
      baseUrl: "https://acmecorp.com/",
    });

    const urls = candidates.map((c) => c.url);
    assert.ok(urls.includes("https://acmecorp.com/about"));
    assert.ok(!urls.some((u) => u.includes("external.com")));
    assert.ok(urls.includes("https://blog.acmecorp.com/team"));
  });

  await test("discoverPageCandidates: drops binary assets and pagination", () => {
    assert.equal(isDroppedUrl("https://acmecorp.com/brochure.pdf"), true);
    assert.equal(isDroppedUrl("https://acmecorp.com/blog/page/2"), true);
    assert.equal(isDroppedUrl("https://acmecorp.com/blog?page=3"), true);
    assert.equal(isDroppedUrl("https://acmecorp.com/wp-admin/"), true);
    assert.equal(isDroppedUrl("https://acmecorp.com/about"), false);
  });

  await test("candidateToTarget: maps discovery metadata onto crawl_targets shape", () => {
    const target = candidateToTarget(
      {
        url: "https://acmecorp.com/team",
        anchorText: "Our Team",
        archetype: "team",
        tier: "high",
        score: 128,
        reason: "team: keyword 'team' matched in url+anchor",
        depth: 1,
      },
      {
        baseUrl: "https://acmecorp.com",
        parentUrl: "https://acmecorp.com/",
        sourceType: "website",
        discoveredBy: "internal-link",
      }
    );

    assert.equal(target.domain, "acmecorp.com");
    assert.equal(target.priority, 1);
    assert.equal(target.archetype, "team");
    assert.equal(target.anchorText, "Our Team");
    assert.equal(target.priorityScore, 128);
    assert.equal(target.parentUrl, "https://acmecorp.com/");
    assert.equal(target.discovered_by, "internal-link");
    assert.ok(target.priorityReason.includes("team"));
  });

  await test("sitemap: robots.txt and xml parsers", () => {
    const robots = "User-agent: *\nSitemap: https://acmecorp.com/sitemap.xml\n";
    assert.deepEqual(
      extractSitemapUrlsFromRobotsTxt(robots),
      ["https://acmecorp.com/sitemap.xml"]
    );

    const xml = `<urlset><url><loc>https://acmecorp.com/team</loc></url><url><loc>https://acmecorp.com/about</loc></url></urlset>`;
    assert.deepEqual(
      extractLocUrlsFromSitemapXml(xml),
      ["https://acmecorp.com/team", "https://acmecorp.com/about"]
    );

    assert.equal(isSitemapIndex("<sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>"), true);
    assert.equal(isSitemapIndex("<urlset><url><loc>x</loc></url></urlset>"), false);
  });

  await test("sitemap: discoverSitemapCandidates via robots.txt, same-domain + asset filter", async () => {
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) {
        return { ok: true, status: 200, text: async () => "Sitemap: https://acmecorp.com/sitemap.xml\n" };
      }
      if (u.endsWith("/sitemap.xml")) {
        return {
          ok: true,
          status: 200,
          text: async () => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://acmecorp.com/our-people</loc></url>
            <url><loc>https://acmecorp.com/contact-us</loc></url>
            <url><loc>https://evil.com/team</loc></url>
            <url><loc>https://acmecorp.com/brochure.pdf</loc></url>
          </urlset>`,
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    };

    const candidates = await discoverSitemapCandidates({
      baseUrl: "https://acmecorp.com",
      fetchImpl,
    });

    const urls = candidates.map((c) => c.url);
    assert.ok(urls.includes("https://acmecorp.com/our-people"));
    assert.ok(urls.includes("https://acmecorp.com/contact-us"));
    assert.ok(!urls.some((u) => u.includes("evil.com")));
    assert.ok(!urls.some((u) => u.endsWith(".pdf")));
  });

  await test("PostgreSQL: crawl_targets persistence of discovery metadata", async () => {
    const suffix = Date.now();
    const url = `https://test-discovery-${suffix}.example.com/leadership`;

    await upsertCrawlTargets([
      candidateToTarget(
        {
          url,
          anchorText: "Leadership",
          archetype: "leadership",
          tier: "high",
          score: 124,
          reason: "leadership: keyword 'leadership' matched in url",
          depth: 1,
        },
        {
          baseUrl: `https://test-discovery-${suffix}.example.com`,
          parentUrl: `https://test-discovery-${suffix}.example.com/`,
          sourceType: "website",
          discoveredBy: "internal-link",
        }
      ),
    ]);

    const row = await getCrawlTarget(url);

    assert.ok(row, "expected persisted crawl_target row");
    assert.equal(row.archetype, "leadership");
    assert.equal(row.anchorText, "Leadership");
    assert.equal(row.priorityScore, 124);
    assert.equal(row.parentUrl, `https://test-discovery-${suffix}.example.com/`);
    assert.equal(row.discovered_by, "internal-link");

    await query(`DELETE FROM crawl_targets WHERE url = $1`, [url]);
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
