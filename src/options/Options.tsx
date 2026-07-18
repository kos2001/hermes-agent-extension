import { useEffect, useState } from "react";
import {
  assertHeadersLatin1,
  HermesError,
  listModels,
  normaliseBaseUrl,
  probeHealth,
  type HealthState,
} from "@/lib/hermes-client";
import { DEFAULT_CONFIG, type ConnectionConfig } from "@/lib/types";
import { getProvider, OPENROUTER_HEADERS, PROVIDERS, type ProviderProfile } from "@/lib/providers";
import { loadConfig, saveConfig } from "@/lib/storage";
import { isLang, LANG_KEY, LANGS, t, type Lang } from "@/lib/i18n";
import {
  clearHiveUrl,
  loadHiveUrl,
  normalizeHiveUrl,
  onHiveUrlChange,
  probeHive,
  saveHiveUrl,
} from "@/lib/cloud/config";

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
  // #gateway / #hive / #language deep-links (e.g. the "키 오류" chip lands here).
  const [tab, setTab] = useState<"connection" | "gateway" | "hive" | "language">(() => {
    const h = location.hash.replace("#", "");
    return h === "gateway" || h === "hive" || h === "language" ? h : "connection";
  });

  // Self-diagnosis on open: probe the SAVED connection so the page tells the
  // user what state they're in before they touch anything.
  const [diag, setDiag] = useState<{ state: HealthState; url: string } | null>(null);
  useEffect(() => {
    void loadConfig().then(async (saved) =>
      setDiag({ state: await probeHealth(saved), url: saved.baseUrl }),
    );
  }, []);

  // Hive server (runtime URL — see lib/cloud/config.ts and the hive-easy-setup spec).
  const [hiveUrl, setHiveUrl] = useState<string | null>(null);
  const [hiveInput, setHiveInput] = useState("");
  const [hiveState, setHiveState] = useState<"idle" | "checking" | "invalid" | "unreachable" | "saved">("idle");
  useEffect(() => {
    void loadHiveUrl().then(setHiveUrl);
    return onHiveUrlChange(setHiveUrl);
  }, []);
  const hiveConnect = async () => {
    const normalized = normalizeHiveUrl(hiveInput);
    if (!normalized) {
      setHiveState("invalid");
      return;
    }
    setHiveState("checking");
    if (!(await probeHive(normalized))) {
      setHiveState("unreachable");
      return;
    }
    await saveHiveUrl(normalized);
    setHiveInput("");
    setHiveState("saved");
  };
  const hiveDisconnect = async () => {
    await clearHiveUrl();
    setHiveState("idle");
  };

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

  // One-tap: point the connection at the local Hermes gateway. This is how
  // OAuth-only providers (Codex, Qwen, etc.) are used — the CLI holds the auth
  // and the extension just talks to the gateway.
  const useGateway = () => {
    setProviderId("");
    setSaved(false);
    setHeadersText("{}");
    setCfg((prev) => ({ ...prev, baseUrl: "http://127.0.0.1:8642", model: "hermes-agent", headers: {} }));
  };

  // Gateway setup helpers: the extension can't read ~/.hermes (sandbox), so we
  // give the user the exact line / command to copy. Works on any machine.
  const [copiedKey, setCopiedKey] = useState("");
  // Default the OS toggle from the browser; the user can flip it.
  const [osKind, setOsKind] = useState<"unix" | "win">(() =>
    /win/i.test(navigator.userAgent) ? "win" : "unix",
  );
  const extId = chrome.runtime?.id ?? "";
  // One-line setup: register this extension's origin in the gateway CORS allow
  // list and restart — via the official `hermes config set` (idempotent). `&&`
  // on POSIX shells, `;` for PowerShell.
  const corsCmd =
    `hermes config set platforms.api_server.extra.cors_origins "chrome-extension://${extId}"` +
    (osKind === "win" ? "; hermes gateway restart" : " && hermes gateway restart");
  // One-liner that prints the full connection string ("baseUrl model token")
  // from the local Hermes config — the user runs it and pastes the output below.
  const connectCmd =
    osKind === "win"
      ? "$f=$false;$t='';foreach($l in Get-Content \"$env:USERPROFILE\\.hermes\\config.yaml\"){if($l -match '^api_server:'){$f=$true};if($f -and $l -match 'token:'){$t=($l -replace '.*token:\\s*','').Trim();break}};\"http://127.0.0.1:8642 hermes-agent $t\""
      : "echo \"http://127.0.0.1:8642 hermes-agent $(awk '/^api_server:/{f=1} f&&/token:/{print $2; exit}' ~/.hermes/config.yaml)\"";
  const [connectStr, setConnectStr] = useState("");
  const [connectMsg, setConnectMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const applyConnect = () => {
    const parts = connectStr.trim().split(/\s+/);
    if (parts.length < 3 || !/^https?:\/\//.test(parts[0])) {
      setConnectMsg({ kind: "err", text: t(lang, "opt.connect.err") });
      return;
    }
    const [baseUrl, model, token] = parts;
    const next: ConnectionConfig = { ...cfg, baseUrl, model, apiKey: token, headers: {} };
    setCfg(next);
    setHeadersText("{}");
    setProviderId("");
    void saveConfig(next);
    setSaved(true);
    setConnectStr("");
    setConnectMsg({ kind: "ok", text: t(lang, "opt.connect.ok") });
  };
  const copy = (text: string, key: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(""), 1500);
      })
      .catch(() => {
        /* clipboard blocked — the text is still visible to copy manually */
      });
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
      // A 401/403 is not "unreachable" — say what it is and how to fix it.
      const rejected = e instanceof HermesError && (e.status === 401 || e.status === 403);
      setProbe({
        kind: "err",
        message: rejected ? t(lang, "opt.test.authHint") : `Cannot reach ${test.baseUrl} — ${msg}`,
      });
    }
  };

  return (
    <div className="wrap">
      <h1>Hermes Agent Chrome — Settings</h1>
      <div className="subtitle">{t(lang, "opt.subtitle")}</div>

      {diag && (
        <div className={`opt-diag ${diag.state}`}>
          {t(lang, `opt.probe.${diag.state === "ok" ? "ok" : diag.state === "auth" ? "auth" : "down"}`).replace(
            "{url}",
            diag.url,
          )}
          {diag.state === "auth" && tab !== "gateway" && (
            <button className="secondary" onClick={() => setTab("gateway")}>
              {t(lang, "opt.probe.goGateway")}
            </button>
          )}
        </div>
      )}

      <div className="tabs">
        <button type="button" className={`tab${tab === "connection" ? " active" : ""}`} onClick={() => setTab("connection")}>
          {t(lang, "opt.sec.connection")}
        </button>
        <button type="button" className={`tab${tab === "gateway" ? " active" : ""}`} onClick={() => setTab("gateway")}>
          {t(lang, "opt.sec.gateway")}
        </button>
        <button type="button" className={`tab${tab === "hive" ? " active" : ""}`} onClick={() => setTab("hive")}>
          Hive
        </button>
        <button type="button" className={`tab${tab === "language" ? " active" : ""}`} onClick={() => setTab("language")}>
          {t(lang, "langName")}
        </button>
      </div>

      {tab === "hive" && (
      <section className="section">
        <p className="section-note">{t(lang, "hive.setup.desc")}</p>
        <p className={`note ${hiveUrl ? "ok" : ""}`}>
          {hiveUrl
            ? t(lang, "hive.setup.current").replace("{url}", hiveUrl)
            : t(lang, "hive.setup.off")}
        </p>
        <div className="field">
          <label>{t(lang, "hive.setup.title")}</label>
          <input
            type="url"
            value={hiveInput}
            placeholder={t(lang, "hive.setup.placeholder")}
            disabled={hiveState === "checking"}
            onChange={(e) => {
              setHiveInput(e.target.value);
              setHiveState("idle");
            }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => void hiveConnect()} disabled={!hiveInput.trim() || hiveState === "checking"}>
              {hiveState === "checking" ? t(lang, "hive.setup.checking") : t(lang, "hive.setup.connect")}
            </button>
            {hiveUrl && (
              <button className="secondary" onClick={() => void hiveDisconnect()}>
                {t(lang, "hive.setup.disconnect")}
              </button>
            )}
            {hiveState === "saved" && <span className="note ok">{t(lang, "hive.setup.saved")}</span>}
            {hiveState === "invalid" && <span className="note err">{t(lang, "hive.setup.invalid")}</span>}
            {hiveState === "unreachable" && <span className="note err">{t(lang, "hive.setup.fail")}</span>}
          </div>
        </div>
      </section>
      )}

      {tab === "language" && (
      <section className="section">
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
      </section>
      )}

      {tab === "connection" && (
      <section className="section">

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
          <div className="note err" style={{ marginTop: 6 }}>
            <p style={{ margin: 0 }}>
              ⚠ {provider.note ?? "Not directly usable with an API key in this extension."}
            </p>
            <button className="secondary" onClick={useGateway} style={{ marginTop: 8 }}>
              {t(lang, "opt.switchGateway")}
            </button>
          </div>
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

      {providerId === "openai-codex" && (
        <div className="field">
          <label>{t(lang, "opt.codex.title")}</label>
          <p className="note" style={{ marginBottom: 6 }}>{t(lang, "opt.codex.body")}</p>
          <pre className="cmd">hermes auth add openai-codex</pre>
        </div>
      )}

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
        <button
          className="secondary"
          onClick={testConnection}
          disabled={provider?.compat === "special"}
          title={provider?.compat === "special" ? t(lang, "opt.testGatewayFirst") : undefined}
        >
          Test connection
        </button>
        {saved && <span className="note ok">Saved.</span>}
      </div>
      {provider?.compat === "special" && (
        <p className="note err" style={{ marginTop: 6 }}>{t(lang, "opt.testGatewayFirst")}</p>
      )}

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
      </section>
      )}

      {tab === "gateway" && (
      <section className="section">
        <p className="section-note">{t(lang, "opt.sec.gateway.body")}</p>

        <div className="lang-options" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`lang-opt${osKind === "unix" ? " active" : ""}`}
            onClick={() => setOsKind("unix")}
          >
            macOS / Linux
          </button>
          <button
            type="button"
            className={`lang-opt${osKind === "win" ? " active" : ""}`}
            onClick={() => setOsKind("win")}
          >
            Windows
          </button>
        </div>

        <div className="field">
          <label>1. {t(lang, "opt.cors.title")}</label>
          <p className="note" style={{ marginBottom: 6 }}>{t(lang, "opt.cors.body")}</p>
          <pre className="cmd">{corsCmd}</pre>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={() => copy(corsCmd, "cors")}>
              {copiedKey === "cors" ? t(lang, "opt.cors.copied") : t(lang, "opt.cors.copy")}
            </button>
          </div>
        </div>

        <div className="field">
          <label>2. {t(lang, "opt.connect.title")}</label>
          <p className="note" style={{ marginBottom: 6 }}>{t(lang, "opt.connect.body")}</p>
          <pre className="cmd">{connectCmd}</pre>
          <div className="row" style={{ marginTop: 6, marginBottom: 6 }}>
            <button className="secondary" onClick={() => copy(connectCmd, "connect")}>
              {copiedKey === "connect" ? t(lang, "opt.cors.copied") : t(lang, "opt.cors.copy")}
            </button>
          </div>
          <input
            type="text"
            value={connectStr}
            placeholder={t(lang, "opt.connect.placeholder")}
            onChange={(e) => {
              setConnectStr(e.target.value);
              setConnectMsg(null);
            }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={applyConnect} disabled={!connectStr.trim()}>{t(lang, "opt.connect.apply")}</button>
            {connectMsg && <span className={`note ${connectMsg.kind === "ok" ? "ok" : "err"}`}>{connectMsg.text}</span>}
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
