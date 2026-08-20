"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const href = `/leagues/${leagueId}/players/${espnPlayerId}`;

  return (
    <Link
      href={href}
      className={cn("text-emerald-300 hover:text-emerald-200 hover:underline", className)}
      onMouseEnter={() => {
        void router.prefetch(href);
      }}
      onFocus={() => {
        void router.prefetch(href);
      }}
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
  const router = useRouter();
  const href = `/leagues/${leagueId}/teams/${espnTeamId}`;

  return (
    <Link
      href={href}
      className={cn("text-emerald-300 hover:text-emerald-200 hover:underline", className)}
      onMouseEnter={() => {
        void router.prefetch(href);
      }}
      onFocus={() => {
        void router.prefetch(href);
      }}
    >
      {children}
    </Link>
  );
}
