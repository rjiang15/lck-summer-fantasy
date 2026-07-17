"use client";

import { useFormStatus } from "react-dom";

export function IngestButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled}>
      {pending ? "Fetching… this may take a few minutes" : label}
    </button>
  );
}
