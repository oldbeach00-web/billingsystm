import { NextResponse } from "next/server";
import { clearSessions } from "@/app/actions/auth";

export async function POST() {
  try {
    await clearSessions();
  } catch {
    // Cookie clearing is best-effort
  }
  return NextResponse.json({ success: true });
}
