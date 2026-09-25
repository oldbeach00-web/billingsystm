/* eslint-disable @typescript-eslint/no-explicit-any */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

function isConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return (
    !!url &&
    url.startsWith("http") &&
    !url.includes("placeholder") &&
    !!key &&
    key !== "placeholder-key"
  );
}

let realSupabaseClient: any = null;

function getSupabaseClient() {
  if (!isConfigured()) return null;
  if (!realSupabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    realSupabaseClient = createBrowserClient<Database>(url, key);
  }
  return realSupabaseClient;
}

type QueryResult = { data: any; error: any; count?: number | null };

function createChainable(): any {
  const resultPromise = Promise.resolve({ data: [], error: null, count: 0 });

  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then") {
        return (onfulfilled?: (value: QueryResult) => any, onrejected?: (reason: any) => any) =>
          resultPromise.then(onfulfilled, onrejected);
      }
      if (prop === "catch") {
        return (onrejected?: (reason: any) => any) => resultPromise.catch(onrejected);
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

  const proxy: any = new Proxy({}, handler);
  return proxy;
}

export const db = {
  from: (table: string) => {
    const client = getSupabaseClient();
    if (client) return client.from(table);
    return createChainable();
  },
  auth: {
    getUser: () => {
      const client = getSupabaseClient();
      if (client) return client.auth.getUser();
      return Promise.resolve({
        data: {
          user: {
            id: "mock-user-id",
            email: "user@example.com",
            user_metadata: { full_name: "Admin User" },
            created_at: "",
            updated_at: "",
          },
        },
        error: null,
      });
    },
    signUp: (args?: any) => {
      const client = getSupabaseClient();
      if (client) return client.auth.signUp(args);
      return Promise.resolve({ data: { user: { id: "mock-user-id" } }, error: null });
    },
    exchangeCodeForSession: (code: string) => {
      const client = getSupabaseClient();
      if (client) return client.auth.exchangeCodeForSession(code);
      return Promise.resolve({ error: null });
    },
    onAuthStateChange: (callback: any) => {
      const client = getSupabaseClient();
      if (client) return client.auth.onAuthStateChange(callback);
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
  },
  rpc: (fn: string, args?: any) => {
    const client = getSupabaseClient();
    if (client) return client.rpc(fn, args);
    return Promise.resolve({ data: null, error: null });
  },
};

export const isDbConfigured = isConfigured;
