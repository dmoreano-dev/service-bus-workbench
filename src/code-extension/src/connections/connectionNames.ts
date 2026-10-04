/** Connection names are compared without case or surrounding spaces: "Prod" and " prod " are the same name. */
const key = (name: string) => name.trim().toLowerCase();

export function isNameTaken(existing: readonly string[], name: string): boolean {
  return existing.some((other) => key(other) === key(name));
}

/** `base` when it is free; otherwise `base 2`, `base 3`… */
export function uniqueName(existing: readonly string[], base: string): string {
  const trimmed = base.trim();
  let candidate = trimmed;
  for (let n = 2; isNameTaken(existing, candidate); n++) {
    candidate = `${trimmed} ${n}`;
  }
  return candidate;
}
