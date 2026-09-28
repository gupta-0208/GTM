import { config } from "../config.js";

function asString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function toCandidate(raw) {
  if (!raw) {
    return null;
  }

  return {
    cin: asString(raw.cin, raw.CIN, raw.cin_number),
    company_name: asString(raw.company_name, raw.companyName, raw.name),
    status: asString(raw.status, raw.company_status),
    registration_date: raw.registration_date ?? raw.date_of_incorporation ?? null,
    source_ref: asString(raw.source_ref, raw.url),
  };
}

function toDetail(raw) {
  const base = toCandidate(raw);

  if (!base) {
    return null;
  }

  const directors = (
    raw.directors ??
    raw.officers ??
    raw.signatories ??
    []
  ).map((director) => ({
    din: asString(director.din, director.DIN),
    name: asString(director.name, director.director_name),
    designation: asString(
      director.designation,
      director.role,
      director.designation_description
    ),
    appointment_date:
      director.appointment_date ??
      director.date_of_appointment ??
      null,
  }));

  return { ...base, directors };
}

// Thin MCA client (public/authorized endpoints only). Gated behind
// MCA_ENABLED so it never issues a live request by default; fetch is
// injectable for mocked responses.
export function createMcaClient(
  cfg = config,
  { fetchImpl = globalThis.fetch } = {}
) {
  const cache = new Map();

  async function request(path) {
    if (!cfg.mcaEnabled) {
      return null;
    }

    const target = String(path || "").trim();

    if (!target) {
      return null;
    }

    if (cache.has(target)) {
      return cache.get(target);
    }

    const endpoint =
      `${cfg.mcaBaseUrl}` +
      (target.startsWith("/") ? target : `/${target}`);

    const headers = {
      Accept: "application/json",
    };

    if (cfg.mcaApiKey) {
      headers.Authorization = `Bearer ${cfg.mcaApiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.mcaTimeoutMs
    );

    try {
      const response = await fetchImpl(endpoint, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      cache.set(target, data);

      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "mca",
    enabled: cfg.mcaEnabled,

    async searchCompany(name) {
      const data = await request(
        `/companies?name=${encodeURIComponent(name)}`
      );

      const items = Array.isArray(data)
        ? data
        : data?.items ?? data?.results ?? [];

      return items.map(toCandidate).filter(Boolean);
    },

    async getCompany(cin) {
      const data = await request(
        `/companies/${encodeURIComponent(cin)}`
      );

      return toDetail(data);
    },
  };
}
