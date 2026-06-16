/**
 * Shared provider icon map used across the TUI.
 */

export function providerIcon(providerId: string): string {
  const iconMap: Record<string, string> = {
    kimi: "🌙",
    "kimi-code": "💻",
    "moonshot-cn": "🌙",
    "moonshot-ai": "🌙",
    openai: "⚡",
    anthropic: "◈",
    "google-genai": "🔷",
    vertexai: "🔷",
    deepseek: "🔮",
    qwen: "🧩",
    siliconflow: "🌊",
    volcengine: "🌋",
    zhipu: "🔮",
    minimax: "🎯",
    yi: "✨",
    baichuan: "🏔️",
    mistral: "🌀",
    groq: "⚡",
    xai: "✖",
    togetherai: "🤝",
    fireworks: "🎆",
    openrouter: "🔀",
    perplexity: "🔍",
    cohere: "🔷",
    deepinfra: "🏗️",
    cerebras: "🧠",
  };
  return iconMap[providerId] ?? "⚡";
}
