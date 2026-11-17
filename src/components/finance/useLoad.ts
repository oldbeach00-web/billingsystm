"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Loads page data on mount and exposes `reload` for after a save.
 * State is only set from the promise callback, never synchronously inside
 * the effect (react-hooks/set-state-in-effect).
 */
export function useLoad<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const run = useCallback(
    () =>
      loader().then(
        (result) => ({ result, error: null as string | null }),
        (err: unknown) => ({
          result: null,
          error: err instanceof Error ? err.message : "Could not load data.",
        })
      ),
    [loader]
  );

  const apply = useCallback((outcome: { result: T | null; error: string | null }) => {
    if (outcome.result !== null) setData(outcome.result);
    setError(outcome.error);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    run().then((outcome) => {
      if (!cancelled) apply(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [run, apply]);

  const reload = useCallback(async () => apply(await run()), [run, apply]);

  return { data, error, setError, isLoading, reload };
}
