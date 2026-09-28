function clean(value) {
  return String(value || "").trim();
}

export function buildDorkQueries(icp) {
  const industry =
    clean(icp.industry) ||
    clean(icp.target_description) ||
    "companies";

  const location = clean(icp.location);
  const product = clean(
    icp.product_or_technology
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