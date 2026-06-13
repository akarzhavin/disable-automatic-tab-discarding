/** Hostname extraction, normalization and subdomain matching. */

/** Schemes whose tabs have a meaningful, matchable hostname. */
const WEB_SCHEMES = new Set(["http:", "https:", "ftp:"]);

/**
 * Return the lowercase hostname for an http(s) URL, or null for restricted /
 * internal pages (chrome://, about:, data:, the Web Store, empty URLs, …).
 */
export function getHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!WEB_SCHEMES.has(u.protocol)) return null;
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Does `hostname` belong to `pattern`? Exact match or a subdomain of it.
 * e.g. domainMatches("mail.example.com", "example.com") === true
 */
export function domainMatches(hostname: string, pattern: string): boolean {
  if (hostname === pattern) return true;
  return hostname.endsWith("." + pattern);
}

/** True if `hostname` matches any pattern in the list. */
export function matchesAny(hostname: string, patterns: string[]): boolean {
  return patterns.some((p) => domainMatches(hostname, p));
}

/**
 * Clean up user input into a bare registrable-ish domain, or null if invalid.
 * Accepts "https://www.Example.com/path", "  Example.com  ", "example.com:8080".
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Strip scheme if present.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Strip everything from the first path/query/hash separator.
  s = s.split(/[/?#]/, 1)[0];
  // Strip a port.
  s = s.split(":", 1)[0];
  // Strip a leading "www." for consistency (subdomain matching still covers it).
  s = s.replace(/^www\./, "");
  // Strip a trailing dot (FQDN form).
  s = s.replace(/\.$/, "");

  if (!s) return null;
  // Basic hostname validation: labels of [a-z0-9-], dot-separated, with a TLD.
  const ok = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s);
  return ok ? s : null;
}
