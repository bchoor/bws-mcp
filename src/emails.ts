export function parseAllowedEmails(raw: string | undefined): string[] {
  if (raw == null || raw.trim() === "") {
    return [];
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email === "" || seen.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export function isEmailAllowed(email: string, allowed: string[]): boolean {
  return allowed.includes(email.trim().toLowerCase());
}
