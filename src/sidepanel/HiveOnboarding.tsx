import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { normalizeHiveUrl, probeHive, saveHiveUrl } from "@/lib/cloud/config";

/**
 * Shown in the 🐝 tab when no Hive server is configured: a one-field
 * onboarding card. The user pastes the address the operator shared; we probe
 * `/api/health` and persist it — `useHiveConfigured` everywhere else picks the
 * change up live, so the feed appears without a reload.
 */
export function HiveOnboarding({ lang }: { lang: Lang }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "invalid" | "unreachable">("idle");

  const connect = async () => {
    const normalized = normalizeHiveUrl(url);
    if (!normalized) {
      setState("invalid");
      return;
    }
    setState("checking");
    if (!(await probeHive(normalized))) {
      setState("unreachable");
      return;
    }
    await saveHiveUrl(normalized);
  };

  return (
    <div className="hive-setup">
      <div className="hive-setup-title">{t(lang, "hive.setup.title")}</div>
      <p className="hive-setup-desc">{t(lang, "hive.setup.desc")}</p>
      <input
        className="hive-input"
        type="url"
        placeholder={t(lang, "hive.setup.placeholder")}
        value={url}
        disabled={state === "checking"}
        onChange={(e) => {
          setUrl(e.target.value);
          setState("idle");
        }}
        onKeyDown={(e) => e.key === "Enter" && void connect()}
      />
      <div className="hive-pop-row">
        <button className="tx-go" onClick={() => void connect()} disabled={!url.trim() || state === "checking"}>
          {state === "checking" ? t(lang, "hive.setup.checking") : t(lang, "hive.setup.connect")}
        </button>
      </div>
      {state === "invalid" && <div className="hive-auth-error">{t(lang, "hive.setup.invalid")}</div>}
      {state === "unreachable" && <div className="hive-auth-error">{t(lang, "hive.setup.fail")}</div>}
    </div>
  );
}
