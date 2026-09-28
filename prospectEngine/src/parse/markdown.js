import { load } from "cheerio";

import { isContactArchetype } from "./archetype.js";

import {
  buildCompanyPayload,
  computeCompanyConfidence,
  domainFromUrl,
} from "./company.js";

export function htmlToMarkdown(html) {
  const $ = load(html || "");

  $("script, style, noscript, iframe, svg, form").remove();

  const lines = [];

  const title = $("title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  if (title) {
    lines.push(`# ${title}`);
  }

  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      const level = Number(el.tagName[1]);

      lines.push(`${"#".repeat(level)} ${text}`);
    }
  });

  $("p, li, blockquote, td, th").each((_, el) => {
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (text && text.length > 2) {
      lines.push(text);
    }
  });

  $("a[href]").each((_, el) => {
    const text = $(el)
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const href = $(el).attr("href");

    if (text && href) {
      lines.push(`[${text}](${href})`);
    }
  });

  return [...new Set(lines)].join("\n");
}

function firstHeadingCompany(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);

  if (!match) {
    return "";
  }

  const parts = match[1].split(
    /\s+\|\s+|\s+[–—-]\s+/
  );

  return parts.length > 1
    ? parts[parts.length - 1]
    : parts[0];
}

function firstParagraph(markdown) {
  const lines = markdown
    .split("\n")
    .filter(
      (line) =>
        line &&
        !line.startsWith("#") &&
        !line.startsWith("[")
    );

  for (const line of lines) {
    if (line.length >= 30) {
      return line;
    }
  }

  return lines[0] || "";
}

export function markdownExtract(archetype, markdown, url) {
  if (isContactArchetype(archetype)) {
    return null;
  }

  const companyName =
    firstHeadingCompany(markdown) ||
    domainFromUrl(url);

  const description = firstParagraph(markdown);

  const payload = buildCompanyPayload({
    companyName,
    description,
    text: markdown,
  });

  return {
    confidence: computeCompanyConfidence(payload),
    payload,
  };
}
