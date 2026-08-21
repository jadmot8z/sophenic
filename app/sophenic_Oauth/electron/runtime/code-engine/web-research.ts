import { URL } from "node:url";

export type WebSearchResult = { title: string; url: string; snippet: string };

const USER_AGENT = "SOPHENIC-CodeEngine/6.0 (+local autonomous developer agent)";

function cleanText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Seules les URL HTTP(S) sont autorisées.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) throw new Error("La recherche Web ne peut pas lire une adresse loopback.");
  return url;
}

export class WebResearchConnector {
  async search(query: string, limit = 6): Promise<WebSearchResult[]> {
    const clean = query.trim();
    if (!clean) return [];
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(clean)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Recherche Web HTTP ${response.status}`);
    const html = await response.text();
    const results: WebSearchResult[] = [];
    const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) && results.length < Math.max(1, Math.min(limit, 10))) {
      const rawUrl = match[1].replace(/&amp;/g, "&");
      let resolved = rawUrl;
      try {
        const candidate = new URL(rawUrl, "https://duckduckgo.com");
        const redirected = candidate.searchParams.get("uddg");
        resolved = redirected ? decodeURIComponent(redirected) : candidate.toString();
        safeHttpUrl(resolved);
      } catch { continue; }
      const title = cleanText(match[2]);
      const tail = html.slice(linkPattern.lastIndex, linkPattern.lastIndex + 1800);
      const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i.exec(tail);
      results.push({ title: title || resolved, url: resolved, snippet: snippetMatch ? cleanText(snippetMatch[1]).slice(0, 500) : "" });
    }
    return results;
  }

  async fetch(urlValue: string, maxChars = 18_000): Promise<{ url: string; status: number; contentType: string; text: string }> {
    const url = safeHttpUrl(urlValue.trim());
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(25_000)
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const text = /html/i.test(contentType) ? cleanText(body) : body.trim();
    return { url: response.url || url.toString(), status: response.status, contentType, text: text.slice(0, Math.max(1_000, Math.min(maxChars, 40_000))) };
  }
}
