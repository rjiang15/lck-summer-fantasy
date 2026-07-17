"use client";

import { usePathname } from "next/navigation";

export default function LeagueSwitcher({ leagues, activeSlug }: { leagues: { slug: string; name: string }[]; activeSlug?: string }) {
  const pathname = usePathname();
  if (leagues.length === 0) return null;
  return <select aria-label="Active fantasy league" value={activeSlug ?? ""} onChange={(event) => {
    window.location.href = `/api/league/select?slug=${encodeURIComponent(event.target.value)}&back=${encodeURIComponent(pathname)}`;
  }}>
    {leagues.map((league) => <option value={league.slug} key={league.slug}>{league.name}</option>)}
  </select>;
}
