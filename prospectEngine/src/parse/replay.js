import {
  getRawPagesForParse,
} from "../storage/pgStore.js";

import {
  parseAndPersist,
} from "./index.js";

export async function replay({
  provider,
  jina,
  version,
  limit = 50,
}) {
  const pages = await getRawPagesForParse({
    parseVersion: version,
    limit,
  });

  const results = [];

  for (const page of pages) {
    results.push(
      await parseAndPersist(page, {
        provider,
        jina,
        version,
      })
    );
  }

  return {
    processed: pages.length,
    results,
  };
}
