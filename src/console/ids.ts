export function newId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid.slice(0, 8)}`;
}
