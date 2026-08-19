import type { MatchedPlayerRef, RosterPlayerForNews } from "@/lib/news/types";

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(team: string | null): string {
  if (!team) return "";
  return team.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PlayerMatchIndex {
  players: RosterPlayerForNews[];
  byNormalizedName: Map<string, RosterPlayerForNews[]>;
}

export function buildPlayerMatchIndex(players: RosterPlayerForNews[]): PlayerMatchIndex {
  const byNormalizedName = new Map<string, RosterPlayerForNews[]>();
  for (const player of players) {
    const key = normalizePlayerName(player.name);
    const list = byNormalizedName.get(key) ?? [];
    list.push(player);
    byNormalizedName.set(key, list);
  }
  return { players, byNormalizedName };
}

function disambiguate(
  candidates: RosterPlayerForNews[],
  text: string,
): RosterPlayerForNews[] {
  if (candidates.length <= 1) return candidates;

  const textNorm = text.toLowerCase();
  const withTeam = candidates.filter((p) => {
    const team = normalizeTeam(p.nflTeam);
    return team && textNorm.includes(team);
  });
  if (withTeam.length === 1) return withTeam;

  const withPos = candidates.filter((p) => {
    const pos = p.position.toLowerCase();
    return pos && textNorm.includes(pos.toLowerCase());
  });
  if (withPos.length === 1) return withPos;

  return candidates;
}

export function matchPlayersInText(
  text: string,
  index: PlayerMatchIndex,
): MatchedPlayerRef[] {
  const haystack = text.toLowerCase();
  const matched = new Map<number, MatchedPlayerRef>();

  for (const player of index.players) {
    const normalized = normalizePlayerName(player.name);
    if (!normalized) continue;

    const fullNameHit = haystack.includes(normalized);
    const parts = normalized.split(" ").filter(Boolean);
    const lastName = parts[parts.length - 1];
    const lastNameHit = lastName && lastName.length >= 4 && haystack.includes(lastName);

    if (!fullNameHit && !lastNameHit) continue;

    const candidates = index.byNormalizedName.get(normalized) ?? [player];
    const resolved = disambiguate(candidates, text);
    for (const p of resolved) {
      matched.set(p.espnPlayerId, {
        espnPlayerId: p.espnPlayerId,
        name: p.name,
        scope: p.scope,
      });
    }
  }

  return [...matched.values()];
}
