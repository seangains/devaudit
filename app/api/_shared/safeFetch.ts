import https from "node:https";
import dns from "node:dns";
import net from "node:net";

// ---------------------------------------------------------------------------
// Outbound POST to a USER-SUPPLIED URL (the deploy route's "Custom webhook"), hardened against
// SSRF. A hostname-string check alone is not enough: any domain the attacker controls can carry
// an A record pointing at 127.0.0.1 or a cloud-metadata address, and IPv6 forms like
// [::ffff:7f00:1] slip past IPv4-only patterns. So instead:
//   1. https:// only, no embedded credentials.
//   2. IP-literal hosts are checked directly.
//   3. Hostnames are resolved by OUR lookup function, every returned address must be public, and
//      the socket connects to exactly the address we validated — so there is no second DNS
//      lookup an attacker can flip to a private address afterwards (DNS rebinding).
//   4. Redirects are never followed; the response is size-capped and time-limited.
// ---------------------------------------------------------------------------

export class WebhookUrlError extends Error {}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (incl. 255.255.255.255)
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  return V4_BLOCKS.some(([base, bits]) => {
    const b = v4ToInt(base)!;
    const size = 2 ** (32 - bits);
    return Math.floor(n / size) === Math.floor(b / size);
  });
}

/** Parses an IPv6 address into eight 16-bit groups (handles "::", an embedded IPv4 tail, zone ids). */
function parseV6(input: string): number[] | null {
  let ip = input.split("%")[0];
  if (ip.includes(".")) {
    const i = ip.lastIndexOf(":");
    const v4 = v4ToInt(ip.slice(i + 1));
    if (v4 === null) return null;
    ip = `${ip.slice(0, i + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** True for any address that is not an ordinary public internet address. Errs on the side of blocking. */
export function isBlockedIp(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) return v4Blocked(ip);
  if (net.isIPv6(ip)) {
    const g = parseV6(ip);
    if (!g) return true;
    // Only global unicast 2000::/3 is allowed. That already blocks ::, ::1, IPv4-mapped/compatible
    // (::ffff:x.x.x.x), NAT64 (64:ff9b::), unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8.
    if ((g[0] & 0xe000) !== 0x2000) return true;
    if (g[0] === 0x2001 && (g[1] & 0xfe00) === 0) return true; // 2001::/23 protocol assignments, incl. Teredo
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x2002) return true; // 6to4 — embeds an arbitrary IPv4
    if ((g[0] & 0xfff0) === 0x3ff0 && g[0] === 0x3fff && (g[1] & 0xf000) === 0) return true; // 3fff::/20 documentation
    return false;
  }
  return true; // not an IP at all
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

function makeLookup(isBlocked: (ip: string) => boolean) {
  return (hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as LookupCb;
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!addrs || addrs.length === 0 || addrs.some((a) => isBlocked(a.address))) {
        const e: NodeJS.ErrnoException = new Error("Blocked address");
        e.code = "EBLOCKED";
        return cb(e);
      }
      if (wantsAll) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

export interface PostOptions {
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Test hook only — production callers must leave this at the default. */
  isBlocked?: (ip: string) => boolean;
}

export interface PostResult {
  status: number;
  text: string;
}

const PRIVATE_MESSAGE = "That looks like a private/internal address, which is not allowed as a deploy target.";

export function postToPublicHttps(urlStr: string, opts: PostOptions): Promise<PostResult> {
  const isBlocked = opts.isBlocked ?? isBlockedIp;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBytes = opts.maxResponseBytes ?? 64 * 1024;

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return Promise.reject(new WebhookUrlError("That deploy webhook URL doesn't look valid."));
  }
  if (url.protocol !== "https:") return Promise.reject(new WebhookUrlError("Deploy webhook URL must start with https://."));
  if (url.username || url.password) return Promise.reject(new WebhookUrlError("Deploy webhook URL can't contain a username or password."));

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return Promise.reject(new WebhookUrlError("That deploy webhook URL doesn't look valid."));
  if (net.isIP(host) && isBlocked(host)) return Promise.reject(new WebhookUrlError(PRIVATE_MESSAGE));

  return new Promise<PostResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = https.request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...opts.headers, "Content-Length": String(Buffer.byteLength(opts.body)) },
        lookup: makeLookup(isBlocked) as unknown as https.RequestOptions["lookup"],
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            return finish(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
          }
          chunks.push(c);
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", (e) => finish(() => reject(e)));
      },
    );

    const timer = setTimeout(() => req.destroy(new Error("Request timed out")), timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) =>
      finish(() => reject(e.code === "EBLOCKED" ? new WebhookUrlError(PRIVATE_MESSAGE) : e)),
    );
    req.end(opts.body);
  });
}
