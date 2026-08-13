// Id and token minting. Ids are UUIDs because the client mints entity ids while offline, so they
// must be globally unique without asking the server.

// Returns a new UUID for a row id.
export function newId(): string {
  return crypto.randomUUID();
}

// Returns an opaque, high-entropy session id. Sessions are looked up by this value, so it is random
// rather than derived from anything about the user.
export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
