import { NextResponse } from "next/server";
import { loginAction } from "@/app/actions/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body || {};

    const result = await loginAction(password);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error?.includes("Incorrect password") ? 401 : 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An error occurred during authentication.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
