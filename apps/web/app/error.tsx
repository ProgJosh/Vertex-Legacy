"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container public-page">
      <div className="error-state" role="alert">
        <h1>We could not load this view.</h1>
        <p>{error.message || "The service returned an unexpected error."}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
