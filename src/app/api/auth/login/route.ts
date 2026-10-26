import { NextResponse } from "next/server";
import { loginAction } from "@/app/actions/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const password = body?.password;

    const result = await loginAction(password);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        {
          status: result.error?.includes("Incorrect password")
            ? 401
            : result.error?.includes("Too many")
              ? 429
              : 400,
        }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Login failed", error);
    return NextResponse.json(
      { success: false, error: "An error occurred during authentication." },
      { status: 500 }
    );
  }
}
