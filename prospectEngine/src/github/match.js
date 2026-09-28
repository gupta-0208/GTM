export function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function domainStem(value) {
  const host = String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  return host.replace(/\.[a-z]{2,}$/i, "");
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length >= 3);
}

// Deterministic company <-> GitHub organisation match score in [0, 1].
// Only exact login/slug hits reach the accept band; fuzzy overlaps land in
// the review band so a weak match is never silently promoted.
export function matchOrganization({
  org,
  companyName = "",
  domain = "",
}) {
  const login = slugify(org?.login || "");
  const displayName = String(org?.name || "").toLowerCase().trim();
  const description = String(org?.description || "").toLowerCase().trim();

  const name = String(companyName || "").toLowerCase().trim();
  const nameSlug = slugify(companyName);
  const stem = slugify(domainStem(domain));

  let score = 0;

  if (nameSlug && login === nameSlug) {
    score = Math.max(score, 0.95);
  }

  if (stem && login === stem) {
    score = Math.max(score, 0.95);
  }

  if (nameSlug.length >= 4) {
    if (login === nameSlug) {
      score = Math.max(score, 0.9);
    } else if (
      login.includes(nameSlug) ||
      nameSlug.includes(login)
    ) {
      score = Math.max(score, 0.7);
    }
  }

  if (
    name.length >= 4 &&
    (displayName.includes(name) || description.includes(name))
  ) {
    score = Math.max(score, 0.6);
  }

  const nameTokens = tokenize(name);
  const loginTokens = tokenize(login);
  const overlap = nameTokens.filter(
    (token) => loginTokens.includes(token)
  ).length;

  if (
    nameTokens.length &&
    overlap >= Math.min(2, nameTokens.length)
  ) {
    score = Math.max(score, 0.5 + overlap * 0.1);
  }

  return Math.round(Math.min(1, score) * 100) / 100;
}

// Aggregates language and topic signals across repositories into a compact
// technology hint summary. Only data actually present on the repos is used.
export function deriveTechnologyHints(repositories) {
  const repos = Array.isArray(repositories)
    ? repositories
    : [];

  const languageCounts = new Map();
  const topics = new Set();

  for (const repo of repos) {
    const language = repo?.language;

    if (language) {
      languageCounts.set(
        language,
        (languageCounts.get(language) || 0) + 1
      );
    }

    for (const topic of repo?.topics || []) {
      topics.add(topic);
    }
  }

  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, repositories]) => ({
      language,
      repositories,
    }));

  return {
    languages,
    topics: [...topics],
  };
}
