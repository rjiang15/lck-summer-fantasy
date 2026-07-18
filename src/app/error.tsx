"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <section className="card empty-state" role="alert">
    <h1>Something unexpected went wrong</h1>
    <p>The rest of your league data is safe. Try loading this page again; if it keeps happening, return to the commissioner dashboard and retry the previous step.</p>
    <div className="inline-form">
      <button type="button" onClick={() => unstable_retry()}>Try again</button>
      <Link href="/commissioner">Commissioner dashboard</Link>
      <Link href="/">League home</Link>
    </div>
  </section>;
}
