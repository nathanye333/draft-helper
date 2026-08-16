import Link from "next/link";
import { cn } from "@/lib/utils";

export function PlayerLink({
  leagueId,
  espnPlayerId,
  children,
  className,
}: {
  leagueId: string;
  espnPlayerId: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/leagues/${leagueId}/players/${espnPlayerId}`}
      className={cn("text-emerald-300 hover:text-emerald-200 hover:underline", className)}
    >
      {children}
    </Link>
  );
}

export function TeamLink({
  leagueId,
  espnTeamId,
  children,
  className,
}: {
  leagueId: string;
  espnTeamId: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/leagues/${leagueId}/teams/${espnTeamId}`}
      className={cn("text-emerald-300 hover:text-emerald-200 hover:underline", className)}
    >
      {children}
    </Link>
  );
}
