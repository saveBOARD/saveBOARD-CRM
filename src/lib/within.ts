// Resolve within `ms` or give up on it, logging under `label`: for optional page sections that must never block a page.
export async function within<T>(ms: number, label: string, p: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[slow] ${label} took over ${ms / 1000} s`);
      resolve(null);
    }, ms);
  });
  const settled = p.catch((e: unknown) => {
    console.warn(`[slow] ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  try {
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(timer);
  }
}
