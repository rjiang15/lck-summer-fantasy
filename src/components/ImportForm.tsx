"use client";

import { useState } from "react";

export default function ImportForm({ leagueId }: { leagueId: number }) {
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
    if (!confirm("Importing replaces this league's rosters, picks, Crystal Ball answers, roles, and scores. A safety checkpoint is created first; other leagues and LCK data are untouched. Continue?")) {
      return;
    }
    setBusy(true);
    setStatus("Importing…");
    try {
      const text = await file.text();
      const res = await fetch(`/api/import?leagueId=${leagueId}`, {
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
    <form onSubmit={onSubmit} className="stack">
      <h3 style={{ marginBottom: 0 }}>Restore from a downloaded file</h3>
      <p className="small muted" style={{ margin: 0 }}>Only the owner can replace a live league from JSON. Every referenced participant account and the shared tournament catalog must already exist.</p>
      <input type="file" name="file" accept="application/json,.json" />
      <button type="submit" disabled={busy} style={{ justifySelf: "start" }}>
        Import backup
      </button>
      {status && <p className="small">{status}</p>}
    </form>
  );
}
