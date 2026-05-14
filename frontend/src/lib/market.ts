import type { Candle, NewsItem, SymbolKey, WatchSymbol } from "./types";
import { authFetch, authenticatedStreamUrl } from "./auth";

export type MarketQuote = Pick<WatchSymbol, "symbol" | "last" | "change" | "changePercent"> & {
  open: number;
  high: number;
  low: number;
  previousClose: number;
  timestamp: number;
  source?: string;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await authFetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getQuote(symbol: SymbolKey) {
  return readJson<MarketQuote>(`/api/markets/quote?symbol=${encodeURIComponent(symbol)}`);
}

export function getMarketNews(symbol: SymbolKey) {
  return readJson<NewsItem[]>(`/api/markets/news?symbol=${encodeURIComponent(symbol)}`);
}

export function getMarketCandles(symbol: SymbolKey, resolution = "D") {
  return readJson<Candle[]>(`/api/markets/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}`);
}

export function marketStreamUrl(symbol: SymbolKey) {
  return authenticatedStreamUrl(`/api/markets/stream?symbol=${encodeURIComponent(symbol)}`);
}
