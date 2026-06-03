import { useEffect, useState } from "react";
import { assertHeadersLatin1, listModels, normaliseBaseUrl } from "@/lib/hermes-client";
import { DEFAULT_CONFIG, type ConnectionConfig } from "@/lib/types";
import { getProvider, OPENROUTER_HEADERS, PROVIDERS, type ProviderProfile } from "@/lib/providers";
import { loadConfig, saveConfig } from "@/lib/storage";
import { isLang, LANG_KEY, LANGS, t, type Lang } from "@/lib/i18n";

type ProbeState =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "ok"; models: string[] }
  | { kind: "err"; message: string };

export default function Options() {
  const [cfg, setCfg] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [headersText, setHeadersText] = useState("{}");
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  const [providerId, setProviderId] = useState<string>("");
  const [lang, setLang] = useState<Lang>("ko");

  useEffect(() => {
    loadConfig().then((loaded) => {
      setCfg(loaded);
      setHeadersText(JSON.stringify(loaded.headers ?? {}, null, 2));
      // Reflect the stored base URL back to a known provider, if it matches.
      const match = PROVIDERS.find(
        (p) => p.baseUrl && normaliseBaseUrl(p.baseUrl) === normaliseBaseUrl(loaded.baseUrl),
      );
      if (match) setProviderId(match.id);
    });
    chrome.storage.local.get(LANG_KEY).then((r) => {
      if (isLang(r[LANG_KEY])) setLang(r[LANG_KEY]);
    });
  }, []);

  // Persist the UI language immediately; the side panel picks it up live via its
  // storage onChanged listener.
  const changeLang = (next: Lang) => {
    setLang(next);
    void chrome.storage.local.set({ [LANG_KEY]: next });
  };

  const setField = <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => {
    setSaved(false);
    setCfg((prev) => ({ ...prev, [key]: value }));
  };

  /** Apply a provider profile: base URL, default model, and OpenRouter headers. */
  const applyProvider = (id: string) => {
    setProviderId(id);
    setSaved(false);
    const p = getProvider(id);
    if (!p) return;
    const headers = id === "openrouter" ? { ...OPENROUTER_HEADERS } : {};
    setHeadersText(JSON.stringify(headers, null, 2));
    setCfg((prev) => ({
      ...prev,
      baseUrl: p.baseUrl || prev.baseUrl,
      model: p.models?.[0] ?? prev.model,
      headers,
    }));
  };

  const provider: ProviderProfile | undefined = getProvider(providerId);

  const save = async () => {
    const headers: Record<string, string> = {};
    try {
      const parsed = headersText.trim() ? JSON.parse(headersText) : {};
      // Coerce values to trimmed strings — trailing whitespace/newlines from
      // pasted values are a common source of bad headers.
      for (const [k, v] of Object.entries(parsed)) headers[k] = String(v).trim();
    } catch {
      setProbe({ kind: "err", message: "Custom headers must be valid JSON" });
      return;
    }
    const clean: ConnectionConfig = {
      ...cfg,
      baseUrl: normaliseBaseUrl(cfg.baseUrl),
      apiKey: cfg.apiKey?.trim(),
      headers,
    };
    // Reject non-Latin-1 chars here (with a precise message) so they never
    // reach fetch as an opaque "non ISO-8859-1 code point" error at request time.
    try {
      const toCheck: Record<string, string> = { ...headers };
      if (clean.apiKey) toCheck.Authorization = `Bearer ${clean.apiKey}`;
      assertHeadersLatin1(toCheck, { Authorization: "API key" });
    } catch (e) {
      setProbe({ kind: "err", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    await saveConfig(clean);
    setCfg(clean);
    setHeadersText(JSON.stringify(headers, null, 2));
    setProbe({ kind: "idle" });
    setSaved(true);
  };

  const testConnection = async () => {
    setProbe({ kind: "probing" });
    const test: ConnectionConfig = {
      ...cfg,
      baseUrl: normaliseBaseUrl(cfg.baseUrl),
    };
    try {
      const models = await listModels(test);
      setProbe({ kind: "ok", models: models.map((m) => m.id) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProbe({ kind: "err", message: `Cannot reach ${test.baseUrl} — ${msg}` });
    }
  };

  return (
    <div className="wrap">
      <h1>Hermes Agent — Settings</h1>
      <div className="subtitle">
        Configure the connection to OpenRouter or your local Hermes server.
      </div>

      <div className="field">
        <label>{t(lang, "langName")}</label>
        <div className="lang-options">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`lang-opt${lang === l.code ? " active" : ""}`}
              onClick={() => changeLang(l.code)}
              title={l.name}
            >
              {l.label} · {l.name}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <label>Provider</label>
        <select
          value={providerId}
          onChange={(e) => applyProvider(e.target.value)}
        >
          <option value="">— select a provider —</option>
          <optgroup label="OpenAI-compatible (works here)">
            {PROVIDERS.filter((p) => p.compat === "openai").map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </optgroup>
          <optgroup label="Requires Hermes CLI (Anthropic / Responses / OAuth)">
            {PROVIDERS.filter((p) => p.compat === "special").map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </optgroup>
        </select>
        {provider?.compat === "special" && (
          <p className="note err" style={{ marginTop: 6 }}>
            ⚠ {provider.note ?? "Not directly usable with an API key in this extension."}
          </p>
        )}
        {provider?.compat === "openai" && provider.note && (
          <p className="note" style={{ marginTop: 6 }}>
            {provider.note}
          </p>
        )}
        {provider && provider.envVar && (
          <p className="note" style={{ marginTop: 6 }}>
            CLI env var: <code>{provider.envVar}</code>
            {provider.signupUrl && (
              <>
                {" · "}
                <a href={provider.signupUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  get a key
                </a>
              </>
            )}
          </p>
        )}
      </label>

      <label className="field">
        <label>Base URL</label>
        <input
          type="text"
          value={cfg.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(e) => setField("baseUrl", e.target.value)}
        />
      </label>

      <label className="field">
        <label>
          API key
          {provider?.signupUrl && (
            <>
              {" "}
              <a
                href={provider.signupUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)" }}
              >
                (get one)
              </a>
            </>
          )}
        </label>
        <input
          type="password"
          value={cfg.apiKey ?? ""}
          placeholder="sk-…"
          onChange={(e) => setField("apiKey", e.target.value)}
        />
      </label>

      <label className="field">
        <label>Default model</label>
        <input
          type="text"
          value={cfg.model}
          placeholder="hermes"
          onChange={(e) => setField("model", e.target.value)}
        />
      </label>

      <label className="field">
        <label>Custom headers (JSON)</label>
        <textarea
          value={headersText}
          onChange={(e) => {
            setSaved(false);
            setHeadersText(e.target.value);
          }}
          placeholder='{ "X-Hermes-Profile": "default" }'
        />
      </label>

      <div className="row">
        <button onClick={save}>Save</button>
        <button className="secondary" onClick={testConnection}>Test connection</button>
        {saved && <span className="note ok">Saved.</span>}
      </div>

      {probe.kind === "probing" && <p className="note">Testing…</p>}
      {probe.kind === "err" && <p className="note err">{probe.message}</p>}
      {probe.kind === "ok" && (
        <div className="note ok">
          Connected. {probe.models.length > 0 && "Available models (click to use):"}
          {probe.models.length > 0 && (
            <div className="models">
              {probe.models.map((id) => (
                <span
                  key={id}
                  className="chip"
                  onClick={() => setField("model", id)}
                  title="Set as default"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
