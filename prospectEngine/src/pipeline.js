import { config } from "./config.js";

import { createProvider } from "./parse/llm/provider.js";
import { createJinaClient } from "./parse/jina.js";

import {
  parseAndPersist,
  parseCompanyContacts,
} from "./parse/index.js";

import {
  classify,
  isContactArchetype,
} from "./parse/archetype.js";

import {
  getRawPagesForParse,
} from "./storage/pgStore.js";

// Reusable extraction stage: parse stored raw_pages into company records, run
// code-based qualification, then extract website contacts only for qualified
// domains. The CLI entry point and the extraction worker both call this so the
// business logic lives in exactly one place.
export async function runExtraction({
  provider,
  jina,
  version = config.currentParseVersion,
  searchPlan = null,
  limit = 5000,
} = {}) {
  const providerInstance =
    provider ?? createProvider(config);

  const jinaInstance =
    jina ?? createJinaClient(config);

  const pages = await getRawPagesForParse({
    parseVersion: version,
    limit,
  });

  const pagesByDomain = new Map();

  for (const page of pages) {
    const domain = page.domain;

    if (!pagesByDomain.has(domain)) {
      pagesByDomain.set(domain, []);
    }

    pagesByDomain.get(domain).push(page);
  }

  const companyPages = pages.filter(
    (page) =>
      !isContactArchetype(classify(page.html, page.url))
  );

  // 1. Company profile parse + code-based qualification.
  const qualifiedDomains = new Set();
  let companyRecords = 0;

  for (const page of companyPages) {
    const result = await parseAndPersist(page, {
      provider: providerInstance,
      jina: jinaInstance,
      version,
      searchPlan,
    });

    if (
      result.persisted &&
      result.recordType === "company"
    ) {
      companyRecords += 1;

      if (result.qualificationStatus === "qualified") {
        qualifiedDomains.add(page.domain);
      }
    }
  }

  // 2. Deep contact extraction only for qualified domains. When no searchPlan
  // was supplied (e.g. the extraction worker runs without a discovery result)
  // qualification cannot gate the crawl, so we fall back to every domain.
  const gateDeepCrawl = Boolean(searchPlan);
  let contactRecords = 0;
  let domainsProcessed = 0;

  for (const domain of pagesByDomain.keys()) {
    if (gateDeepCrawl && !qualifiedDomains.has(domain)) {
      continue;
    }

    const summary = await parseCompanyContacts({
      domain,
      provider: providerInstance,
      jina: jinaInstance,
      version,
      pages: pagesByDomain.get(domain),
    });

    contactRecords += summary.persisted;
    domainsProcessed += 1;
  }

  return {
    pagesProcessed: pages.length,
    companyRecords,
    domainsProcessed,
    contactRecords,
    qualifiedDomains: [...qualifiedDomains],
  };
}
