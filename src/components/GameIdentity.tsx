"use client";

import Image from "next/image";
import { useState } from "react";

type IdentitySize = "xs" | "sm" | "md" | "lg";

const DATA_DRAGON_VERSION = "16.14.1";

const CHAMPION_ID_ALIASES: Record<string, string> = {
  belveth: "Belveth",
  chogath: "Chogath",
  drmundo: "DrMundo",
  kaisa: "Kaisa",
  khazix: "Khazix",
  ksante: "KSante",
  leblanc: "Leblanc",
  nunuandwillump: "Nunu",
  reksai: "RekSai",
  renataglasc: "Renata",
  velkoz: "Velkoz",
  wukong: "MonkeyKing",
};

const TEAM_LOGOS: Record<string, string> = {
  bnkfearx: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/0/0f/BNK_FEARXlogo_profile.png/revision/latest?cb=20241225073827",
  dnsoopers: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/2/25/DN_SOOPerslogo_profile.png/revision/latest?cb=20251222013254",
  dpluskia: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/7e/Dplus_Kialogo_profile.png/revision/latest?cb=20230512045312",
  geng: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/e/e3/Gen.Glogo_square.png/revision/latest?cb=20260114104755",
  hanjinbrion: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/3/32/HANJIN_BRIONlogo_profile.png/revision/latest?cb=20260309061908",
  hanwhalifeesports: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/e/e9/Hanwha_Life_Esportslogo_profile.png/revision/latest?cb=20260119144058",
  kiwoomdrx: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/6/62/Kiwoom_DRXlogo_profile.png/revision/latest?cb=20260327112704",
  ktrolster: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/5/5c/KT_Rolsterlogo_profile.png/revision/latest?cb=20260123152940",
  nongshimredforce: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/b/b8/Nongshim_RedForcelogo_square.png/revision/latest?cb=20260114093156",
  t1: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/78/T1logo_profile.png/revision/latest?cb=20221015004607",
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function championId(name: string) {
  const normalized = normalize(name.replace(/&/g, "and"));
  return CHAMPION_ID_ALIASES[normalized] ?? name.replace(/[^a-zA-Z0-9]/g, "");
}

function fallbackText(name: string, kind: "champion" | "team") {
  if (kind === "champion") return name.trim().charAt(0).toUpperCase() || "?";
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  return words.slice(0, 3).map((word) => word[0]).join("").toUpperCase() || "?";
}

function IdentityIcon({
  name,
  kind,
  size,
}: {
  name: string;
  kind: "champion" | "team";
  size: IdentitySize;
}) {
  const src = kind === "champion"
    ? `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/champion/${championId(name)}.png`
    : TEAM_LOGOS[normalize(name)];
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const visibleSrc = src && failedSrc !== src ? src : null;

  return <span className={`entity-icon ${kind} ${size}`} aria-hidden="true">
    {visibleSrc
      ? <Image src={visibleSrc} alt="" width={64} height={64} sizes="64px" onError={() => setFailedSrc(visibleSrc)} />
      : <span className="entity-fallback">{fallbackText(name, kind)}</span>}
  </span>;
}

export function ChampionIcon({ name, size = "sm" }: { name: string; size?: IdentitySize }) {
  return <IdentityIcon name={name} kind="champion" size={size} />;
}

export function TeamLogo({ name, size = "sm" }: { name: string; size?: IdentitySize }) {
  return <IdentityIcon name={name} kind="team" size={size} />;
}

export function ChampionLabel({
  name,
  size = "sm",
  className = "",
}: {
  name: string;
  size?: IdentitySize;
  className?: string;
}) {
  return <span className={`entity-label ${className}`.trim()}><ChampionIcon name={name} size={size} /><span>{name}</span></span>;
}

export function TeamLabel({
  name,
  size = "sm",
  className = "",
}: {
  name: string;
  size?: IdentitySize;
  className?: string;
}) {
  return <span className={`entity-label ${className}`.trim()}><TeamLogo name={name} size={size} /><span>{name}</span></span>;
}
