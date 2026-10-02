import { discover } from "./discovery/discoveryService.js";
import { crawlTargets } from "./crawl/crawlers.js";
import { runExtraction } from "./pipeline.js";

export async function runFinder(query, icp = null, job = null) {
  const update = async (stage, detail) => {
    await job?.updateProgress({ stage, detail, updatedAt: new Date().toISOString() });
  };

  await update("discovery", "Searching for companies that match your query");
  const discovery = await discover(query, icp);
  const targets = discovery.targets || [];
  const domains = [...new Set(targets.map((target) => target.domain).filter(Boolean))];

  if (!targets.length) {
    await update("complete", "Search finished with no approved websites to crawl");
    return {
      query,
      discovery,
      crawl: { targetsSelected: 0, pagesStored: 0 },
      extraction: { pagesProcessed: 0, companyRecords: 0, contactRecords: 0 },
    };
  }

  await update("crawl", `Crawling ${targets.length} approved company websites`);
  const crawl = await crawlTargets(targets);

  await update("extraction", "Extracting and qualifying company and contact records");
  const extraction = await runExtraction({
    searchPlan: discovery.searchPlan,
    domains: new Set(domains),
    icp,
    runId: job?.id || null,
  });

  await update("complete", "Finder run finished");
  return { query, discovery, crawl, extraction };
}
