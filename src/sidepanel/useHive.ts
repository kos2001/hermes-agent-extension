import { useEffect, useState } from "react";
import { initHive } from "@/lib/cloud/client";
import { onHiveUrlChange } from "@/lib/cloud/config";

/**
 * Whether a Hive server is configured — `null` while the first storage read is
 * in flight. Re-applies the URL to the shared PocketBase client and re-renders
 * live when the user saves or clears it (Settings, onboarding card), so Hive
 * entry points appear/disappear without a rebuild or reload.
 */
export function useHiveConfigured(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      void initHive().then((v) => {
        if (!cancelled) setOn(v);
      });
    };
    apply();
    const off = onHiveUrlChange(apply);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return on;
}
