import Link from "next/link";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "", label: "Overview" },
  { href: "/start-sit", label: "Start/Sit" },
  { href: "/trades", label: "Trades" },
  { href: "/waivers", label: "Players" },
  { href: "/news", label: "News" },
] as const;

export function LeagueNav({
  leagueId,
  current,
}: {
  leagueId: string;
  current: "overview" | "start-sit" | "trades" | "waivers" | "news";
}) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
      {LINKS.map((link) => {
        const key =
          link.href === ""
            ? "overview"
            : (link.href.slice(1) as typeof current);
        const href = `/leagues/${leagueId}${link.href}`;
        const active = current === key;
        return (
          <Link
            key={link.label}
            href={href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition",
              active
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
