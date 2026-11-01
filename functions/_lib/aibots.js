// The AI crawlers, assistants and data collectors Ozimut refuses (site/robots.txt names the same; owner, 2026-11-01), by the
// words of their user agent. Used to sort what Cloudflare's analytics report (_lib/robots.js). Keep it in step with robots.txt.
export const AI_BOTS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "GoogleOther",
  "Google-CloudVertexBot", "Applebot-Extended", "PerplexityBot", "Perplexity-User", "CCBot", "Bytespider", "Amazonbot",
  "meta-externalagent", "meta-externalfetcher", "FacebookBot", "cohere-ai", "cohere-training-data-crawler", "MistralAI-User",
  "DuckAssistBot", "YouBot", "Diffbot", "Omgilibot", "ImagesiftBot", "Timpibot", "AI2Bot",
];
// longest first, so that « ChatGPT-User » is not taken for a shorter name it contains
const BY_LENGTH = [...AI_BOTS].sort((a, b) => b.length - a.length);
/** The AI bot a user agent names, or "". */
export function aiBot(ua) {
  const s = String(ua || "").toLowerCase();
  return BY_LENGTH.find((b) => s.includes(b.toLowerCase())) || "";
}
