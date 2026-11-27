// ---------------------------------------------------------------------------
// Helpers for project invitations (app/api/invites/**).
//
// The rules these enforce:
//   * Someone is looked up by an EXACT account match — a GitHub username or a full email address.
//     The old client-side lookup used ilike with the raw input, so `%` / `_` acted as wildcards and
//     a few typed characters could probe which accounts exist.
//   * Nothing here ever selects or returns an email address. People are shown by GitHub username,
//     or a neutral label when they don't have one.
// ---------------------------------------------------------------------------

/** Plain id shape accepted for project and invite ids (UUIDs and simple identifiers). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// GitHub usernames: 1-39 characters, letters/digits/hyphens (underscores appear in enterprise
// "managed user" names), starting with a letter or digit.
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
// A deliberately conservative email shape. `%`, `*`, `\`, `,`, parentheses and quotes are not
// accepted at all, so the value can never be mistaken for a pattern or filter syntax.
const EMAIL_RE = /^[A-Za-z0-9._+'-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const MAX_IDENTIFIER_CHARS = 254;

/** Escapes LIKE/ILIKE metacharacters so the value matches itself literally. Used with ilike purely
 *  to get a case-insensitive EXACT comparison. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export type InviteLookup = { column: "email" | "github_username"; pattern: string };

/** Turns what the owner typed into an exact, case-insensitive lookup — or null if it isn't a
 *  plausible GitHub username or email address. */
export function parseInviteIdentifier(input: unknown): InviteLookup | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_IDENTIFIER_CHARS) return null;

  if (raw.includes("@") && !raw.startsWith("@")) {
    return EMAIL_RE.test(raw) ? { column: "email", pattern: escapeLike(raw) } : null;
  }
  const username = raw.replace(/^@/, "");
  return USERNAME_RE.test(username) ? { column: "github_username", pattern: escapeLike(username) } : null;
}

/** How a person is named in the UI. Never an email address. */
export function displayName(profile: { github_username?: string | null } | null | undefined): string {
  const name = profile?.github_username?.trim();
  return name ? `@${name}` : "DevAudit user";
}
