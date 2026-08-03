export function gameDetailHref(gameId: string) {
  return `/games/${encodeURIComponent(gameId)}`;
}
