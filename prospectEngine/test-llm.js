import { config } from "./src/config.js";
import { getSearchCache } from "./src/storage/localStore.js";
import { classifyCandidates } from "./src/relevance/companyRelevance.js";
import { createProvider } from "./src/parse/llm/provider.js";

async function run() {
  const cache = await getSearchCache();
  let results = [];
  for (const v of Object.values(cache)) {
    if (v.results) results.push(...v.results);
  }
  // take a few unique domains
  const domains = [...new Set(results.map(r => new URL(r.url).hostname))].slice(0, 5);
  
  const fakeCandidates = domains.map(d => {
     const items = results.filter(r => new URL(r.url).hostname === d);
     return {
       domain: d,
       title: items[0].title,
       url: items[0].url,
       snippets: items.map(i => i.content).join(" | ")
     };
  });
  
  const provider = createProvider(config);
  
  const result = await classifyCandidates(
    provider,
    {
      userQuery: "Find 10 India-based founder-led B2B SaaS, agencies, consultants, coaches, and IT services companies that could benefit from LinkAssist.",
      searchPlan: { industry: "B2B SaaS" }
    },
    fakeCandidates
  );
  
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
