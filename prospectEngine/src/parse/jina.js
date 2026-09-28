import { config } from "../config.js";

// Jina Reader returns clean Markdown for a page URL. This client is gated
// behind JINA_ENABLED and caches results by URL so repeated Tier-2 attempts
// against the same page do not re-hit the network.
export function createJinaClient(
  cfg = config,
  { fetchImpl = globalThis.fetch } = {}
) {
  const cache = new Map();

  async function fetchMarkdown(url) {
    if (!cfg.jinaEnabled) {
      return null;
    }

    const target = String(url || "").trim();

    if (!target) {
      return null;
    }

    if (cache.has(target)) {
      return cache.get(target);
    }

    const endpoint = `${cfg.jinaBaseUrl}/${target}`;

    const headers = {
      Accept: "text/markdown",
    };

    if (cfg.jinaApiKey) {
      headers.Authorization = `Bearer ${cfg.jinaApiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.jinaTimeoutMs
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

      const markdown = await response.text();

      if (!markdown || !markdown.trim()) {
        return null;
      }

      cache.set(target, markdown);

      return markdown;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "jina",
    enabled: cfg.jinaEnabled,
    fetchMarkdown,
  };
}
