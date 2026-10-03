function clean(value) {
  return String(value || "").trim();
}

export function buildDorkQueries(icp = {}) {
  const industry =
    clean(icp.industry) ||
    (Array.isArray(icp.industries) ? icp.industries.map(clean).filter(Boolean).join(", ") : "") ||
    (Array.isArray(icp.company_types) ? icp.company_types.map(clean).filter(Boolean).join(", ") : "") ||
    clean(icp.target_description) ||
    clean(icp.ideal_customer) ||
    "companies";

  const location = clean(icp.location);
  const product = clean(
    icp.product_or_technology ||
    icp.name ||
    icp.product_description ||
    icp.offering
  );

  const locationPart = location
    ? `"${location}"`
    : "";

  const productPart = product
    ? `"${product}"`
    : "";

  return [
    `intitle:pricing "${industry}" ${locationPart} -site:g2.com -site:capterra.com`,

    `inurl:careers "${industry}" ${locationPart}`,

    `${productPart} "${industry}" ${locationPart} company`,

    `"${industry}" ${locationPart} "about us"`,

    `"${industry}" ${locationPart} "official website"`,
  ]
    .map((query) => query.trim())
    .filter(Boolean);
}
