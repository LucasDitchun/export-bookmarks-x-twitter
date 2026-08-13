export function createLocaleCatalogCache<T>(
  loadCatalog: (locale: string) => Promise<T>,
): (locale: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();

  return (locale) => {
    const cached = cache.get(locale);
    if (cached) return cached;

    const loading = Promise.resolve().then(() => loadCatalog(locale));
    cache.set(locale, loading);
    void loading.catch(() => {
      if (cache.get(locale) === loading) cache.delete(locale);
    });
    return loading;
  };
}
