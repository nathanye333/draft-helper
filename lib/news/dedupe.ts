import { createHash } from "crypto";
import type { RawNewsHit } from "@/lib/news/types";

export function urlHash(url: string): string {
  return createHash("sha256").update(url.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeRawHits(hits: RawNewsHit[]): RawNewsHit[] {
  const byUrl = new Map<string, RawNewsHit>();
  const byTitle = new Map<string, RawNewsHit>();

  for (const hit of hits) {
    const urlKey = hit.url.trim().toLowerCase();
    if (!byUrl.has(urlKey)) {
      byUrl.set(urlKey, hit);
    }

    const titleKey = normalizeTitle(hit.title);
    if (titleKey && !byTitle.has(titleKey)) {
      byTitle.set(titleKey, hit);
    }
  }

  const merged = new Map<string, RawNewsHit>();
  for (const hit of byUrl.values()) {
    merged.set(urlHash(hit.url), hit);
  }
  for (const hit of byTitle.values()) {
    const key = urlHash(hit.url);
    if (!merged.has(key)) merged.set(key, hit);
  }

  return [...merged.values()];
}

export function corroborationCounts(hits: RawNewsHit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = normalizeTitle(hit.title);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
