import { load } from "cheerio";

import {
  ROLE_HINT,
  dedupeContacts,
  normalizeContact,
  parseNameTitleLine,
} from "../contact.js";

const CARD_SELECTOR = [
  "[class*='team']",
  "[class*='member']",
  "[class*='person']",
  "[class*='profile']",
  "[class*='staff']",
  "[class*='leadership']",
  "[class*='author']",
  "[class*='founder']",
  "[class*='bio']",
  "[class*='executive']",
  "[class*='director']",
  "[class*='lead']",
  "[class*='people']",
  "[class*='employee']",
  "[itemtype*='Person']",
].join(",");

const NAME_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[class*='name']",
  "[itemprop='name']",
].join(",");

const TITLE_SELECTOR = [
  "[class*='title']",
  "[class*='role']",
  "[class*='position']",
  "[class*='job-title']",
  "[itemprop='jobTitle']",
].join(",");

const PROFILE_URL_RE =
  /(linkedin\.com|twitter\.com|x\.com|github\.com|crunchbase\.com)/i;

const AUTHOR_SELECTORS = [
  ".byline",
  ".author",
  ".post-author",
  ".article-author",
  ".author-name",
  "[rel='author']",
  "meta[name='author']",
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectPersonJsonLd(data, out = []) {
  if (Array.isArray(data)) {
    for (const item of data) {
      collectPersonJsonLd(item, out);
    }

    return out;
  }

  if (!data || typeof data !== "object") {
    return out;
  }

  const type = data["@type"];

  if (
    type === "Person" ||
    (Array.isArray(type) && type.includes("Person"))
  ) {
    out.push(data);
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === "object") {
      collectPersonJsonLd(value, out);
    }
  }

  return out;
}

function extractPersonFromElement($, element, url) {
  const $el = $(element);

  let name = clean($el.find(NAME_SELECTOR).first().text());

  if (!name) {
    const aria = $el.attr("aria-label") ||
      $el.find("[aria-label]").first().attr("aria-label");

    name = clean(aria);
  }

  let title = clean($el.find(TITLE_SELECTOR).first().text());

  if (!title) {
    const hinted = $el
      .find("p, span, div")
      .filter((_, el) => ROLE_HINT.test($(el).text()))
      .first();

    title = clean(hinted.text());
  }

  let email = "";
  let phone = "";

  const mailto = $el.find("a[href^='mailto:']").first();
  const tel = $el.find("a[href^='tel:']").first();

  if (mailto.length) {
    email = mailto.attr("href").replace(/^mailto:/i, "").trim();
  }

  if (tel.length) {
    phone = tel.attr("href").replace(/^tel:/i, "").trim();
  }

  const profile_urls = [];

  $el.find("a[href]").each((_, a) => {
    const href = $(a).attr("href");

    if (href && PROFILE_URL_RE.test(href)) {
      profile_urls.push(href);
    }
  });

  if (!name && !email && !phone) {
    return null;
  }

  return {
    full_name: name,
    title,
    email,
    phone,
    profile_urls,
    source_url: url,
  };
}

function extractAuthorByline($) {
  for (const selector of AUTHOR_SELECTORS) {
    const el = $(selector).first();

    if (!el.length) {
      continue;
    }

    let text = clean(el.attr("content") || el.text());

    text = text.replace(/^(by|written by|author)\s*[:|-]?\s*/i, "");
    text = text.split(/\s+\|\s+|\s+[–—-]\s+/)[0];
    text = text.split(/\d{4}/)[0].trim();

    const parsed = parseNameTitleLine(text);

    if (parsed) {
      return parsed;
    }

    if (text && text.length <= 80 && !text.includes("@")) {
      return { name: text, title: "" };
    }
  }

  return null;
}

export function deterministicContactExtract(archetype, html, url) {
  const $ = load(html || "");
  const candidates = [];

  $("script[type='application/ld+json']").each((_, script) => {
    let data;

    try {
      data = JSON.parse($(script).html());
    } catch {
      return;
    }

    for (const person of collectPersonJsonLd(data)) {
      candidates.push({
        full_name: person.name,
        title: person.jobTitle,
        email: person.email,
        phone: person.telephone,
        profile_urls: person.url ? [person.url] : [],
        source_url: url,
      });
    }
  });

  const seen = new Set();

  $(CARD_SELECTOR).each((_, element) => {
    const person = extractPersonFromElement($, element, url);

    if (person) {
      candidates.push(person);
      seen.add(element);
    }
  });

  $("a[href^='mailto:'], a[href^='tel:']").each((_, anchor) => {
    let inside = false;

    $(anchor).parents().each((_, parent) => {
      if (seen.has(parent)) {
        inside = true;
        return false;
      }
    });

    if (inside) {
      return;
    }

    const container = $(anchor).closest("li, p, div, td, tr").first();
    const person = extractPersonFromElement(
      $,
      container.length ? container : anchor,
      url
    );

    if (!person) {
      return;
    }

    const href = $(anchor).attr("href") || "";

    if (href.startsWith("mailto:")) {
      person.email = person.email || href.slice(7);
    }

    if (href.startsWith("tel:")) {
      person.phone = person.phone || href.slice(4);
    }

    if (!person.full_name) {
      const anchorText = clean($(anchor).text());

      if (
        anchorText &&
        !anchorText.includes("@") &&
        !/^\+?[0-9()\s.-]+$/.test(anchorText)
      ) {
        person.full_name = anchorText;
      }
    }

    if (person.full_name || person.email || person.phone) {
      candidates.push(person);
    }
  });

  const author = extractAuthorByline($);

  if (author) {
    candidates.push({
      full_name: author.name,
      title: author.title || "",
      email: "",
      phone: "",
      profile_urls: [],
      source_url: url,
    });
  }

  return dedupeContacts(
    candidates.map((c) => normalizeContact(c))
  ).filter((c) => c.full_name || c.email || c.phone);
}
