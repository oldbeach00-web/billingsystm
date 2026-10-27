/* eslint-disable @typescript-eslint/no-explicit-any */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabaseFetch } from "@/lib/supabaseFetch";

let isConfiguredCache: boolean | null = null;

function isConfigured(): boolean {
  if (isConfiguredCache !== null) return isConfiguredCache;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  isConfiguredCache =
    !!url &&
    url.startsWith("http") &&
    !url.includes("placeholder") &&
    !!key &&
    key !== "placeholder-key";

  return isConfiguredCache;
}

let realSupabaseClient: SupabaseClient<Database> | null = null;

function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isConfigured()) return null;

  if (!realSupabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    realSupabaseClient = createBrowserClient<Database>(url, key, {
      global: { fetch: supabaseFetch },
    });
  }

  return realSupabaseClient;
}

type QueryResult = {
  data: unknown;
  error: unknown;
  count?: number | null;
};

const NOT_CONFIGURED_ERROR = {
  message:
    "Database is not configured. Nothing was saved. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  code: "DB_NOT_CONFIGURED",
};

const MUTATIONS = new Set(["insert", "update", "upsert", "delete"]);

// Stand-in query builder used when Supabase isn't configured. Reads return
// empty results; writes return an error so nothing ever reports a fake save.
function createChainable(isWrite = false): unknown {
  const resultPromise = Promise.resolve(
    isWrite
      ? { data: null, error: NOT_CONFIGURED_ERROR, count: 0 }
      : { data: [], error: null, count: 0 }
  );

  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then") {
        return (
          onfulfilled?: (value: QueryResult) => any,
          onrejected?: (reason: unknown) => any
        ) => resultPromise.then(onfulfilled, onrejected);
      }

      if (prop === "catch") {
        return (onrejected?: (reason: unknown) => any) =>
          resultPromise.catch(onrejected);
      }

      if (prop === "single" || prop === "maybeSingle") {
        return () =>
          Promise.resolve({
            data: null,
            error: isWrite ? NOT_CONFIGURED_ERROR : null,
          });
      }

      if (typeof prop === "string" && MUTATIONS.has(prop)) {
        return () => createChainable(true);
      }

      return () => proxy;
    },
  };

  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

export const db = {
  from: (table: string) => {
    const client = getSupabaseClient();

    if (client) {
      return client.from(table as never);
    }

    return createChainable() as ReturnType<SupabaseClient<Database>["from"]>;
  },

  auth: {
    getUser: async () => {
      const client = getSupabaseClient();

      if (client) {
        // A configured database must never fall back to the mock user:
        // without a real session every write would be attributed to a fake id.
        try {
          return await client.auth.getUser();
        } catch {
          return { data: { user: null }, error: null };
        }
      }

      return Promise.resolve({
        data: {
          user: {
            id: "00000000-0000-0000-0000-000000000000",
            email: "admin@shop.local",
            user_metadata: { full_name: "Shop Admin" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        error: null,
      });
    },

    onAuthStateChange: (callback: unknown) => {
      const client = getSupabaseClient();

      if (client) {
        return client.auth.onAuthStateChange(callback as never);
      }

      return {
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      };
    },
  },

  rpc: (fn: string, args?: unknown) => {
    const client = getSupabaseClient();

    if (client) {
      return client.rpc(fn as never, args as never);
    }

    return Promise.resolve({
      data: null,
      error: NOT_CONFIGURED_ERROR,
    });
  },
};

const PAGE_SIZE = 1000;

/**
 * Fetches every row of a query, page by page. Supabase returns at most 1000
 * rows per request, so a plain select silently truncates large tables.
 * `build` must return a fresh, ordered query for each call.
 */
export async function fetchAllRows<T>(
  build: () => {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);

    if (error) return { data: rows, error };

    const page = (data as T[] | null) ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}

export const isDbConfigured = isConfigured;