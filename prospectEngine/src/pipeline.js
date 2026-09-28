import { config } from "./config.js";

import { createProvider } from "./parse/llm/provider.js";
import { createJinaClient } from "./parse/jina.js";

import {
  parseAndPersist,
  parseCompanyContacts,
} from "./parse/index.js";

import {
  getRawPagesForParse,
} from "./storage/pgStore.js";

// Reusable extraction stage: parse stored raw_pages into company records, then
// extract website contacts per domain (deduplicated within each company). The
// CLI entry point and the extraction worker both call this so the business
// logic lives in exactly one place.
export async function runExtraction({
  provider,
  jina,
  version = config.currentParseVersion,
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

  const domains = [
    ...new Set(
      pages
        .map((page) => page.domain)
        .filter(Boolean)
    ),
  ];

  // Contact extraction runs first so it sees the unparsed page set; company
  // parsing then processes the same in-memory pages. Both stages are idempotent
  // across repeated runs via the raw_pages.parse_version gate.
  let contactRecords = 0;

  for (const domain of domains) {
    const summary = await parseCompanyContacts({
      domain,
      provider: providerInstance,
      jina: jinaInstance,
      version,
    });

    contactRecords += summary.persisted;
  }

  let companyRecords = 0;

  for (const page of pages) {
    const result = await parseAndPersist(page, {
      provider: providerInstance,
      jina: jinaInstance,
      version,
    });

    if (
      result.persisted &&
      result.recordType === "company"
    ) {
      companyRecords += 1;
    }
  }

  return {
    pagesProcessed: pages.length,
    companyRecords,
    domainsProcessed: domains.length,
    contactRecords,
  };
}
