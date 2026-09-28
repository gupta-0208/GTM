import {
  dedupeContacts,
  normalizeContact,
  parseNameTitleLine,
} from "./contact.js";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?[0-9][0-9\s().-]{6,}[0-9])/;

export function markdownContactExtract(archetype, markdown, url) {
  const candidates = [];

  for (const rawLine of String(markdown || "").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const email = line.match(EMAIL_RE)?.[0] || "";
    const phone = line.match(PHONE_RE)?.[0] || "";

    const nameTitle = parseNameTitleLine(line);

    if (nameTitle) {
      candidates.push({
        full_name: nameTitle.name,
        title: nameTitle.title,
        email,
        phone,
        profile_urls: [],
        source_url: url,
      });
    } else if (email || phone) {
      candidates.push({
        full_name: "",
        title: "",
        email,
        phone,
        profile_urls: [],
        source_url: url,
      });
    }
  }

  return dedupeContacts(
    candidates.map((c) => normalizeContact(c))
  ).filter((c) => c.full_name || c.email || c.phone);
}
