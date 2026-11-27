import { NextResponse } from "next/server";

// Returns a generic message to the client while logging the real one server-side (visible in
// Vercel's function logs). Raw Postgres/Supabase error text can reveal table and column names,
// which is low-risk but unnecessary information to hand to a client. `context` is a short label
// (e.g. "tokens.GET") so you can find the right log line quickly.
export function safeError(context: string, e: unknown, status = 500, publicMessage?: string) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${context}]`, message);
  return NextResponse.json({ error: publicMessage ?? "Something went wrong. Please try again." }, { status });
}
