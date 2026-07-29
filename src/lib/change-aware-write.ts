export type WriteCounts = {
  created: number;
  updated: number;
  unchanged: number;
};

export function createWriteCounts(): WriteCounts {
  return { created: 0, updated: 0, unchanged: 0 };
}

export function recordChanged(
  existing: object,
  incoming: Record<string, unknown>,
) {
  const stored = existing as Record<string, unknown>;
  return Object.entries(incoming).some(([key, value]) => !sameValue(stored[key], value));
}

export async function writeIfChanged<T extends object>({
  existing,
  incoming,
  counts,
  create,
  update,
}: {
  existing: T | null;
  incoming: Record<string, unknown>;
  counts: WriteCounts;
  create: () => Promise<unknown>;
  update: () => Promise<unknown>;
}) {
  if (!existing) {
    await create();
    counts.created++;
    return "created" as const;
  }
  if (recordChanged(existing, incoming)) {
    await update();
    counts.updated++;
    return "updated" as const;
  }
  counts.unchanged++;
  return "unchanged" as const;
}

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date || right instanceof Date) {
    const leftTime = left instanceof Date ? left.getTime() : new Date(String(left)).getTime();
    const rightTime = right instanceof Date ? right.getTime() : new Date(String(right)).getTime();
    return leftTime === rightTime;
  }
  return Object.is(left, right);
}
