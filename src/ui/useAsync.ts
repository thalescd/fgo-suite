import { useEffect, useState } from "react";

/**
 * Carregamento sob demanda de um documento.
 *
 * O `alive` não é cerimônia: trocar de servo antes de a resposta anterior
 * chegar faria a resposta velha sobrescrever a nova.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    load().then(
      (d) => alive && setData(d),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
}
