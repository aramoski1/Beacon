"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border bg-card p-6 space-y-4 text-center">
        <h1 className="text-lg font-semibold tracking-tight">This page couldn’t load</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong. Try again, or go back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            Reload
          </button>
          <Link
            href="/dashboard"
            className="h-8 inline-flex items-center rounded-md border px-3 text-sm font-medium"
          >
            Back
          </Link>
        </div>
      </div>
    </div>
  );
}
