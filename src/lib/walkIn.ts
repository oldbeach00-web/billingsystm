import { db } from "@/lib/db";

// Bills for customers who don't give their details all point at one shared
// customer record with this name. create_invoice() requires a customer, so
// this keeps walk-in sales working without a database change.
export const WALK_IN_NAME = "Walk-in Customer";

export function isWalkInCustomer(c?: { name?: string | null } | null): boolean {
  return (c?.name || "").trim().toLowerCase() === WALK_IN_NAME.toLowerCase();
}

type IdRow = { id: string };
type WalkInRow = { id: string; is_active: boolean };

async function findWalkInCustomer(): Promise<WalkInRow | null> {
  const { data, error } = await db
    .from("customers")
    .select("id, is_active")
    .ilike("name", WALK_IN_NAME)
    .order("created_at")
    .limit(1);

  if (error) throw new Error((error as { message?: string }).message);

  const rows = (data ?? []) as WalkInRow[];
  return rows[0] ?? null;
}

// Ids of every customer record named like the walk-in one (normally just one).
export async function findWalkInCustomerIds(): Promise<string[]> {
  const { data, error } = await db
    .from("customers")
    .select("id")
    .ilike("name", WALK_IN_NAME);

  if (error) throw new Error((error as { message?: string }).message);

  return ((data ?? []) as IdRow[]).map((r) => r.id);
}

// Returns the shared walk-in record's id, creating it on first use. An archived
// record is reactivated so it keeps showing in the Customers walk-in section.
export async function getOrCreateWalkInCustomerId(): Promise<string> {
  const existing = await findWalkInCustomer();

  if (existing) {
    if (!existing.is_active) {
      await db.from("customers").update({ is_active: true }).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data, error } = await db
    .from("customers")
    .insert([{ name: WALK_IN_NAME, country: "India" }])
    .select("id")
    .single();

  if (error) {
    throw new Error(
      "Error creating walk-in customer: " +
        (error as { message?: string }).message
    );
  }

  const row = data as IdRow | null;
  if (!row?.id) throw new Error("Walk-in customer record was not created.");

  return row.id;
}
