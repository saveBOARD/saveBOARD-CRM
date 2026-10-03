/** Only allow a same-site path to return to after sign-in, never another website ("//evil.com", "/\evil.com"). */
export function safeCallback(value: string | string[] | undefined | null): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  return /[\u0000-\u001f]/.test(v) ? "/" : v;
}
