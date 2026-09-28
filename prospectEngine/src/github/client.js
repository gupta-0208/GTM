import { config } from "../config.js";

// Thin GitHub REST client (official api.github.com endpoints only). Results
// are cached by request path and fetch is injectable so enrichment can be
// exercised without a live API call.
export function createGithubClient(
  cfg = config,
  { fetchImpl = globalThis.fetch } = {}
) {
  const cache = new Map();

  async function request(path) {
    const target = String(path || "").trim();

    if (!target) {
      return null;
    }

    if (cache.has(target)) {
      return cache.get(target);
    }

    const endpoint =
      `${cfg.githubApiBaseUrl}` +
      (target.startsWith("/") ? target : `/${target}`);

    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "bda-prospect-engine",
    };

    if (cfg.githubToken) {
      headers.Authorization = `Bearer ${cfg.githubToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.githubTimeoutMs
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
    name: "github",
    request,

    async searchOrganizations(query) {
      const data = await request(
        `/search/users?q=${encodeURIComponent(query)}+type:org&per_page=10`
      );

      return data?.items ?? [];
    },

    async listPublicMembers(login) {
      return request(
        `/orgs/${encodeURIComponent(login)}/public_members?per_page=100`
      );
    },

    async listRepositories(login) {
      return request(
        `/orgs/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`
      );
    },
  };
}
