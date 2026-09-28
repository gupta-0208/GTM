export function dedupeByDomain(candidates) {
  const groups = new Map();

  for (const candidate of candidates) {
    const existing =
      groups.get(candidate.domain) || [];

    existing.push(candidate);

    groups.set(
      candidate.domain,
      existing
    );
  }

  const unique = [];

  for (const [domain, items] of groups) {
    const sorted = [...items].sort(
      (a, b) =>
        a.priority - b.priority
    );

    const best = sorted[0];

    unique.push({
      ...best,
      matchedQueries: [
        ...new Set(
          items.flatMap(
            (item) =>
              item.matchedQueries || [
                item.query,
              ]
          )
        ),
      ],
      occurrences: items.length,
    });
  }

  return unique;
}