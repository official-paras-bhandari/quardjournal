import type { Candle, Holding, NewsItem, SymbolKey, WatchSymbol } from "./types";
import { authFetch } from "./auth";

export function knownSymbolsFromPrompt(prompt: string): SymbolKey[] {
  return ["NVDA", "AAPL", "TSLA", "MSFT", "AMD", "ETHUSD", "EURUSD"].filter((symbol) => prompt.toUpperCase().includes(symbol)) as SymbolKey[];
}

type AiMarketContext = {
  symbol: SymbolKey;
  quote?: Partial<WatchSymbol>;
  candles: Candle[];
  news: NewsItem[];
  portfolio?: Holding[];
  chatMode?: string;
};

async function postAi<T>(url: string, body: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `AI request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function analyzeMarket(context: AiMarketContext) {
  return postAi<{ model: string; content: string }>("/api/ai/analyze", context);
}

export function chatAboutMarket(context: AiMarketContext & { prompt: string; messages: Array<{ role: string; content: string }> }) {
  return postAi<{ model: string; content: string; activity?: string[]; sources?: "web" | "local"; memoryUsed?: string[]; memorySaved?: string[] }>("/api/ai/chat", context);
}

export type MemoryItem = {
  id: string;
  category: "identity" | "assistant_persona" | "investment_style" | "trading_style" | "portfolio_thesis" | "symbol_context" | "journal_lesson" | "attachment_context";
  content: string;
  symbol: string;
  source: "system_seed" | "user_pinned" | "chat_derived" | "attachment";
  pinned: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContextAttachment = {
  id: string;
  title: string;
  content: string;
  symbol: string;
  scope: "global" | "symbol";
  createdAt: string;
};

export function fetchMemories(symbol?: string) {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return authFetch(`/api/memory${query}`).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Memory request failed");
    return response.json() as Promise<MemoryItem[]>;
  });
}

export function createMemory(input: Pick<MemoryItem, "category" | "content"> & Partial<Pick<MemoryItem, "symbol" | "pinned" | "source">>) {
  return postAi<MemoryItem>("/api/memory", input);
}

export function updateMemory(id: string, patch: Partial<MemoryItem>) {
  return authFetch(`/api/memory/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Memory update failed");
    return response.json() as Promise<MemoryItem>;
  });
}

export function deleteMemory(id: string) {
  return authFetch(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Memory delete failed");
    return response.json() as Promise<{ deleted: boolean }>;
  });
}

export function createContextAttachment(input: { title: string; content: string; symbol?: string; scope?: "global" | "symbol" }) {
  return postAi<ContextAttachment>("/api/attachments/context", input);
}

export function fetchPortfolio() {
  return authFetch("/api/portfolio").then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Portfolio fetch failed");
    return response.json() as Promise<Holding[]>;
  });
}

export function savePortfolioItem(input: Partial<Holding>) {
  return postAi<Holding>("/api/portfolio", input);
}

export function deletePortfolioItem(id: string) {
  return authFetch(`/api/portfolio/${encodeURIComponent(id)}`, { method: "DELETE" }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Portfolio delete failed");
    return response.json() as Promise<{ deleted: boolean }>;
  });
}

// ─── Journal ─────────────────────────────────────────────────────────────────
export type JournalEntry = {
  id?: string;
  timestamp: string;
  ticker: string;
  side: string;
  price: string;
  duration: string;
  rr: string;
  tag: string;
  pnl: string;
  notes: string;
};

export function fetchJournal() {
  return authFetch("/api/journal").then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Journal fetch failed");
    return response.json() as Promise<JournalEntry[]>;
  });
}

export function saveJournalEntry(input: Partial<JournalEntry>) {
  return postAi<JournalEntry>("/api/journal", input);
}

export function deleteJournalEntry(id: string) {
  return authFetch(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" }).then(async (response) => {
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Journal delete failed");
    return response.json() as Promise<{ deleted: boolean }>;
  });
}
