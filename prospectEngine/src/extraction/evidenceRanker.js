function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function buildTerms(searchPlan) {
  const source = [
    searchPlan.target_description,
    searchPlan.location,
    searchPlan.industry,
    searchPlan.company_type,
    searchPlan.product_or_technology,
    searchPlan.relationship,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    ...new Set(tokenize(source)),
  ];
}

function scorePage(page, terms) {
  const title = page.title.toLowerCase();

  const headings =
    page.headings.join(" ").toLowerCase();

  const url = page.url.toLowerCase();

  const text = page.text.toLowerCase();

  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) {
      score += 8;
    }

    if (headings.includes(term)) {
      score += 5;
    }

    if (url.includes(term)) {
      score += 4;
    }

    if (text.includes(term)) {
      score += 1;
    }
  }

  const importantPaths = [
    "/about",
    "/company",
    "/product",
    "/products",
    "/service",
    "/services",
    "/solution",
    "/solutions",
    "/technology",
    "/industry",
    "/customer",
    "/client",
    "/case-study",
  ];

  for (const path of importantPaths) {
    if (url.includes(path)) {
      score += 4;
    }
  }

  return score;
}

export function rankEvidencePages(
  pages,
  searchPlan,
  limit
) {
  const terms = buildTerms(searchPlan);

  return [...pages]
    .map((page) => ({
      ...page,
      relevance_score: scorePage(page, terms),
    }))
    .sort(
      (a, b) =>
        b.relevance_score - a.relevance_score
    )
    .slice(0, limit);
}