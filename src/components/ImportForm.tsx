"use client";

import { useState } from "react";

export default function ImportForm() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setStatus("Choose a backup file first.");
      return;
    }
    if (!confirm("Importing REPLACES all current rosters, picks, and crystal ball answers. Continue?")) {
      return;
    }
    setBusy(true);
    setStatus("Importing…");
    try {
      const text = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const json = await res.json();
      setStatus(json.ok ? "Import successful — reload any open pages." : `Import failed: ${json.error}`);
    } catch (err) {
      setStatus(`Import failed: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="file" name="file" accept="application/json,.json" />
      <button type="submit" disabled={busy} style={{ marginLeft: "0.5rem" }}>
        Import backup
      </button>
      {status && <p className="small">{status}</p>}
    </form>
  );
}
