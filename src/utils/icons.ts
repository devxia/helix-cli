export function providerIcon(providerId: string): string {
  const icons: Record<string, string> = {
    "moonshotai-cn": "🌙",
    moonshotai: "🌙",
    "kimi-for-coding": "💻",
    openai: "⚡",
    anthropic: "◈",
    google: "🔷",
    "google-vertex": "🔷",
    deepseek: "🔮",
    "alibaba-cn": "🧩",
    siliconflow: "🌊",
    "siliconflow-cn": "🌊",
    zhipuai: "🔮",
    minimax: "🎯",
    mistral: "🌀",
    groq: "⚡",
    xai: "✖",
    togetherai: "🤝",
    "fireworks-ai": "🎆",
    openrouter: "🔀",
    perplexity: "🔍",
    cohere: "🔷",
    deepinfra: "🏗️",
    cerebras: "🧠",
  };
  return icons[providerId] ?? "⚡";
}
