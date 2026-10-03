import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const cachePath = path.resolve(config.storageDir, "searxng-cache.json");

export async function getSearchCache() {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function setSearchCache(key, value) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const cache = await getSearchCache();
  cache[String(key)] = value;
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporaryPath, cachePath);
  return cache[String(key)];
}
