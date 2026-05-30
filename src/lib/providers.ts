/**
 * Provider registry — mirrors the providers the Hermes Agent CLI knows about.
 *
 * Ported from NousResearch/hermes-agent `plugins/model-providers/<name>/`
 * (each `ProviderProfile`). The CLI supports many providers; this extension
 * speaks only the OpenAI-compatible `chat/completions` surface over a Bearer
 * API key, so each profile carries a `compat` flag:
 *
 *   - "openai"  → usable directly here (api_mode chat_completions + api_key auth)
 *   - "special" → needs the Hermes CLI/gateway (Anthropic/Bedrock/Responses APIs,
 *                 OAuth/AWS/Copilot auth). Listed for completeness; the options
 *                 page warns and does not pretend the key alone will work.
 *
 * `baseUrl` is the full OpenAI base (including the version path), matching how
 * Hermes stores it. The HTTP client appends `/chat/completions` and `/models`.
 */

export type ProviderCompat = "openai" | "special";

export interface ProviderProfile {
  id: string;
  displayName: string;
  /** Full OpenAI base URL incl. version path. Empty = user must supply (custom/azure). */
  baseUrl: string;
  /** Explicit models endpoint; defaults to `${baseUrl}/models`. */
  modelsUrl?: string;
  /** Primary CLI env var that holds this provider's API key (for the hint). */
  envVar?: string;
  signupUrl?: string;
  /** Curated fallback models (first is used as the default model). */
  models?: string[];
  compat: ProviderCompat;
  /** Hermes api_mode — informational; non-chat_completions ⇒ "special". */
  apiMode: string;
  /** False when the provider's /models probe is unreliable (skip health check). */
  healthCheck?: boolean;
  /** Why a "special" provider can't be used with just a key here. */
  note?: string;
}

export const PROVIDERS: ProviderProfile[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    envVar: "OPENROUTER_API_KEY",
    signupUrl: "https://openrouter.ai/keys",
    models: [
      "openrouter/auto",
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-5.4",
      "deepseek/deepseek-chat",
      "google/gemini-3-flash-preview",
      "qwen/qwen3-plus",
    ],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "openai-api",
    displayName: "OpenAI (API key)",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    signupUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.4", "gpt-5.4-mini", "o4-mini"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "nous",
    displayName: "Nous Research",
    baseUrl: "https://inference.nousresearch.com/v1",
    envVar: "NOUS_API_KEY",
    signupUrl: "https://nousresearch.com/",
    models: ["hermes-3-405b", "hermes-3-70b"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "hermes-local",
    displayName: "Hermes (local server)",
    baseUrl: "http://127.0.0.1:8642/v1",
    models: ["gpt-5.5"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio (local)",
    baseUrl: "http://127.0.0.1:1234/v1",
    envVar: "LM_API_KEY",
    signupUrl: "https://lmstudio.ai/",
    compat: "openai",
    apiMode: "chat_completions",
    // LM Studio's local server needs no real key — any placeholder works.
    note: "Local server: start LM Studio's server; any non-empty API key works.",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    envVar: "DEEPSEEK_API_KEY",
    signupUrl: "https://platform.deepseek.com/",
    models: ["deepseek-chat", "deepseek-reasoner"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    // OpenAI-compatible surface (Hermes uses a native client; this is the REST equivalent).
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-3-flash-preview", "gemini-3-pro-preview"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "zai",
    displayName: "Z.AI (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    envVar: "GLM_API_KEY",
    signupUrl: "https://z.ai/",
    models: ["glm-5", "glm-4-9b"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "kimi-coding",
    displayName: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/v1",
    envVar: "KIMI_API_KEY",
    signupUrl: "https://platform.moonshot.ai/",
    models: ["kimi-k2-turbo-preview"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "kimi-coding-cn",
    displayName: "Kimi (Moonshot CN)",
    baseUrl: "https://api.moonshot.cn/v1",
    envVar: "KIMI_CN_API_KEY",
    models: ["kimi-k2-turbo-preview"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "nvidia",
    displayName: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envVar: "NVIDIA_API_KEY",
    signupUrl: "https://build.nvidia.com/",
    models: ["nvidia/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "novita",
    displayName: "NovitaAI",
    baseUrl: "https://api.novita.ai/openai/v1",
    envVar: "NOVITA_API_KEY",
    signupUrl: "https://novita.ai/settings/key-management",
    models: ["deepseek/deepseek-v3-0324", "moonshotai/kimi-k2.5", "zai-org/glm-5"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "gmi",
    displayName: "GMI Cloud",
    baseUrl: "https://api.gmi-serving.com/v1",
    envVar: "GMI_API_KEY",
    signupUrl: "https://www.gmicloud.ai/",
    models: ["deepseek-ai/DeepSeek-V3.2", "zai-org/GLM-5.1-FP8", "moonshotai/Kimi-K2.5"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "huggingface",
    displayName: "HuggingFace",
    baseUrl: "https://router.huggingface.co/v1",
    envVar: "HF_TOKEN",
    signupUrl: "https://huggingface.co/settings/tokens",
    models: ["Qwen/Qwen3.5-72B-Instruct", "deepseek-ai/DeepSeek-V3.2"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "alibaba",
    displayName: "Alibaba Cloud (DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envVar: "DASHSCOPE_API_KEY",
    signupUrl: "https://help.aliyun.com/zh/model-studio/",
    models: ["qwen3-plus", "qwen3-max"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "alibaba-coding-plan",
    displayName: "Alibaba Cloud (Coding Plan)",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    envVar: "ALIBABA_CODING_PLAN_API_KEY",
    signupUrl: "https://help.aliyun.com/zh/model-studio/",
    models: ["qwen3-coder-plus"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "arcee",
    displayName: "Arcee AI",
    baseUrl: "https://api.arcee.ai/api/v1",
    envVar: "ARCEEAI_API_KEY",
    signupUrl: "https://www.arcee.ai/",
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "stepfun",
    displayName: "StepFun",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    envVar: "STEPFUN_API_KEY",
    models: ["step-3.5-flash"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "tencent-tokenhub",
    displayName: "Tencent TokenHub",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    envVar: "TOKENHUB_API_KEY",
    signupUrl: "https://tokenhub.tencentmaas.com/",
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "xiaomi",
    displayName: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    envVar: "XIAOMI_API_KEY",
    compat: "openai",
    apiMode: "chat_completions",
    healthCheck: false,
  },
  {
    id: "ollama-cloud",
    displayName: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    envVar: "OLLAMA_API_KEY",
    signupUrl: "https://ollama.com/",
    models: ["nemotron-3-nano:30b"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "kilocode",
    displayName: "Kilo Code",
    baseUrl: "https://api.kilo.ai/api/gateway",
    envVar: "KILOCODE_API_KEY",
    signupUrl: "https://kilo.ai/",
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "opencode-zen",
    displayName: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    envVar: "OPENCODE_ZEN_API_KEY",
    models: ["gemini-3-flash"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "opencode-go",
    displayName: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    envVar: "OPENCODE_GO_API_KEY",
    models: ["glm-5"],
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "azure-foundry",
    displayName: "Azure Foundry (enter base URL)",
    baseUrl: "",
    envVar: "AZURE_FOUNDRY_API_KEY",
    signupUrl: "https://ai.azure.com/",
    compat: "openai",
    apiMode: "chat_completions",
  },
  {
    id: "custom",
    displayName: "Custom (OpenAI-compatible)",
    baseUrl: "",
    compat: "openai",
    apiMode: "chat_completions",
  },

  // ── Listed for completeness — need the Hermes CLI/gateway, not usable
  //    with a plain API key over OpenAI chat/completions in this extension. ──
  {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    signupUrl: "https://console.anthropic.com/",
    compat: "special",
    apiMode: "anthropic_messages",
    note: "Uses the Anthropic Messages API, not OpenAI chat/completions — run it through the Hermes CLI.",
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: "https://api.minimax.io/anthropic",
    envVar: "MINIMAX_API_KEY",
    signupUrl: "https://api.minimax.io/",
    compat: "special",
    apiMode: "anthropic_messages",
    note: "Anthropic Messages API surface — use the Hermes CLI.",
  },
  {
    id: "minimax-cn",
    displayName: "MiniMax (China)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    envVar: "MINIMAX_CN_API_KEY",
    compat: "special",
    apiMode: "anthropic_messages",
    note: "Anthropic Messages API surface — use the Hermes CLI.",
  },
  {
    id: "xai",
    displayName: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    envVar: "XAI_API_KEY",
    signupUrl: "https://x.ai/api",
    compat: "special",
    apiMode: "codex_responses",
    note: "Hermes routes xAI via the Responses API; the extension only speaks chat/completions.",
  },
  {
    id: "openai-codex",
    displayName: "OpenAI Codex (ChatGPT OAuth)",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    signupUrl: "https://chatgpt.com/",
    compat: "special",
    apiMode: "codex_responses",
    note: "Responses API + ChatGPT OAuth — requires the Hermes CLI.",
  },
  {
    id: "bedrock",
    displayName: "AWS Bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    signupUrl: "https://aws.amazon.com/bedrock/",
    compat: "special",
    apiMode: "bedrock_converse",
    note: "AWS SigV4 credentials + Converse API — requires the Hermes CLI.",
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    baseUrl: "https://api.githubcopilot.com",
    envVar: "COPILOT_GITHUB_TOKEN",
    signupUrl: "https://github.com/features/copilot",
    compat: "special",
    apiMode: "chat_completions",
    note: "Needs Copilot token exchange — run it through the Hermes CLI.",
  },
  {
    id: "qwen-oauth",
    displayName: "Qwen (OAuth)",
    baseUrl: "https://portal.qwen.ai/v1",
    signupUrl: "https://chat.qwen.ai/",
    compat: "special",
    apiMode: "chat_completions",
    note: "OAuth browser flow — requires the Hermes CLI.",
  },
];

/** First "openai"-compatible provider, used as the initial default. */
export const DEFAULT_PROVIDER_ID = "openrouter";

export function getProvider(id: string): ProviderProfile | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** OpenRouter attribution headers (recommended when using OpenRouter). */
export const OPENROUTER_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://github.com/local/hermes-agent-extension",
  "X-Title": "Hermes Agent Extension",
};
