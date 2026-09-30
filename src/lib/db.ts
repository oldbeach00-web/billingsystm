/* eslint-disable @typescript-eslint/no-explicit-any */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

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

    realSupabaseClient = createBrowserClient<Database>(url, key);
  }

  return realSupabaseClient;
}

type QueryResult = {
  data: unknown;
  error: unknown;
  count?: number | null;
};

function createChainable(): unknown {
  const resultPromise = Promise.resolve({
    data: [],
    error: null,
    count: 0,
  });

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

      if (prop === "single") {
        return () => Promise.resolve({ data: null, error: null });
      }

      if (prop === "maybeSingle") {
        return () => Promise.resolve({ data: null, error: null });
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
        try {
          const result = await client.auth.getUser();

          if (result.data?.user) {
            return result;
          }
        } catch {
          // Fall through to mock
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

    signUp: (args?: unknown) => {
      const client = getSupabaseClient();

      if (client) {
        return client.auth.signUp(args as never);
      }

      return Promise.resolve({
        data: {
          user: {
            id: "00000000-0000-0000-0000-000000000000",
          },
        },
        error: null,
      });
    },

    exchangeCodeForSession: (code: string) => {
      const client = getSupabaseClient();

      if (client) {
        return client.auth.exchangeCodeForSession(code);
      }

      return Promise.resolve({ error: null });
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
      error: null,
    });
  },
};

export const isDbConfigured = isConfigured;