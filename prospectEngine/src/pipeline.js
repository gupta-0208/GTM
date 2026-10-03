import {
  config,
} from "./config.js";

import {
  createProvider,
} from "./parse/llm/provider.js";

import {
  createJinaClient,
} from "./parse/jina.js";

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

export async function runExtraction({
  provider,
  jina,
  version =
    config.currentParseVersion,
  searchPlan = null,
  icp = null,
  runId = null,
  domains = null,
  limit = 5000,
} = {}) {
  const providerInstance =
    provider ??
    createProvider(config);

  const jinaInstance =
    jina ??
    createJinaClient(config);

  const rawPages =
    await getRawPagesForParse({
      parseVersion:
        version,
      limit,
    });

  //
  // Important:
  // When a discovery run supplies domains, only process pages from those
  // discovered domains. This prevents old database rows from contaminating
  // the current run.
  //
  const allowedDomains =
    domains instanceof Set
      ? domains
      : null;

  const pages =
    allowedDomains
      ? rawPages.filter(
          (page) =>
            allowedDomains.has(
              page.domain,
            ),
        )
      : rawPages;

  const pagesByDomain =
    new Map();

  for (const page of pages) {
    const domain =
      page.domain;

    if (
      !pagesByDomain.has(
        domain,
      )
    ) {
      pagesByDomain.set(
        domain,
        [],
      );
    }

    pagesByDomain
      .get(domain)
      .push(page);
  }

  const companyPages =
    pages.filter(
      (page) =>
        !isContactArchetype(
          classify(
            page.html,
            page.url,
          ),
        ),
    );

  const qualifiedDomains =
    new Set();
  const contactCandidateDomains =
    new Set();

  let companyRecords = 0;

  for (
    const page of
      companyPages
  ) {
    const result =
      await parseAndPersist(
        page,
        {
          provider:
            providerInstance,

          jina:
            jinaInstance,

          version,

          searchPlan,
          icp,
          runId,
        },
      );

    if (
      result.persisted &&
      result.recordType ===
        "company"
    ) {
      companyRecords += 1;

      if (
        result.qualificationStatus ===
        "qualified"
      ) {
        qualifiedDomains.add(
          page.domain,
        );
      }

      if (
        result.qualificationStatus !==
        "not_qualified"
      ) {
        contactCandidateDomains.add(
          page.domain,
        );
      }
    }
  }

  const gateDeepCrawl =
    Boolean(searchPlan);

  let contactRecords = 0;
  let domainsProcessed = 0;

  for (
    const domain of
      pagesByDomain.keys()
  ) {
    if (gateDeepCrawl && !contactCandidateDomains.has(domain)) {
      continue;
    }

    const summary =
      await parseCompanyContacts({
        domain,

        provider:
          providerInstance,

        jina:
          jinaInstance,

        version,

        pages:
          pagesByDomain.get(
            domain,
          ),
        runId,
        icp,
      });

    contactRecords +=
      summary.persisted;

    domainsProcessed += 1;
  }

  return {
    pagesProcessed:
      pages.length,

    companyRecords,

    domainsProcessed,

    contactRecords,

    qualifiedDomains: [
      ...qualifiedDomains,
    ],
  };
}
