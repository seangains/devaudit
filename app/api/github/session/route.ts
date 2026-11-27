import { NextResponse } from "next/server";
import { supabaseForRequest } from "@/api/_shared/supabaseForRequest";
import { hasGithubConnection } from "@/api/_shared/githubConnections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the browser whether this account has a GitHub connection. Never returns the token. */
export async function GET(req: Request) {
  const noStore = { "Cache-Control": "no-store" };
  try {
    const {
      data: { user },
    } = await supabaseForRequest(req).auth.getUser();
    if (!user) return NextResponse.json({ connected: false }, { headers: noStore });
    return NextResponse.json({ connected: await hasGithubConnection(user.id) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Couldn't check the GitHub connection." }, { status: 500, headers: noStore });
  }
}
