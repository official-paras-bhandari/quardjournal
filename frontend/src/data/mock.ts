import type { Candle, NewsItem, WatchSymbol } from "../lib/types";

export const watchlist: WatchSymbol[] = [
  { symbol: "NVDA", name: "NVIDIA Corporation", venue: "NASDAQ", last: 220.78, change: 8.15, changePercent: 3.83, volume: "159.18M", marketCap: "5.36T", nextEarnings: "In 8 days" },
  { symbol: "AAPL", name: "Apple Inc.", venue: "NASDAQ", last: 286.91, change: -1.64, changePercent: -0.57, volume: "72.40M", marketCap: "4.24T", nextEarnings: "Jun 18" },
  { symbol: "TSLA", name: "Tesla Inc.", venue: "NASDAQ", last: 489.12, change: 12.08, changePercent: 2.53, volume: "98.13M", marketCap: "1.56T", nextEarnings: "Jul 22" },
  { symbol: "MSFT", name: "Microsoft Corporation", venue: "NASDAQ", last: 612.44, change: 4.21, changePercent: 0.69, volume: "38.04M", marketCap: "4.55T", nextEarnings: "Jul 29" },
  { symbol: "AMD", name: "Advanced Micro Devices", venue: "NASDAQ", last: 182.35, change: -3.18, changePercent: -1.71, volume: "61.77M", marketCap: "295.8B", nextEarnings: "Aug 4" },
  { symbol: "ETHUSD", name: "Ethereum", venue: "CRYPTO", last: 2300.09, change: 25.94, changePercent: 1.14, volume: "18.2B" },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", venue: "FX", last: 1.17119, change: -0.00264, changePercent: -0.22, volume: "Spot" }
];

const baseSeries = [18, 18.5, 19, 21, 23, 22, 24, 25, 29, 34, 33, 31, 35, 38, 44, 51, 63, 78, 92, 111, 118, 126, 104, 97, 119, 148, 171, 190, 184, 196, 176, 221];

export function candlesFor(symbol: string): Candle[] {
  const symbolOffset = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 23;
  return baseSeries.map((value, index) => {
    const close = value + symbolOffset + Math.sin(index) * 3;
    const open = close - 2 + Math.cos(index / 2) * 4;
    const high = Math.max(open, close) + 4 + (index % 4);
    const low = Math.min(open, close) - 3 - (index % 3);
    const month = `${2023 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
    return { time: month, open: Number(open.toFixed(2)), high: Number(high.toFixed(2)), low: Number(low.toFixed(2)), close: Number(close.toFixed(2)), volume: 12000000 + index * 1850000 };
  });
}

export const news: NewsItem[] = [
  {
    id: "n1",
    symbol: "NVDA",
    headline: "AI infrastructure demand keeps mega-cap chip names in focus",
    source: "Market Desk",
    impact: "high",
    timestamp: "09:10",
    summary: "Semiconductor names are leading pre-market scanners after another wave of datacenter spending notes."
  },
  {
    id: "n2",
    symbol: "MARKET",
    headline: "Yields ease as traders wait for the next inflation print",
    source: "Macro Pulse",
    impact: "medium",
    timestamp: "08:35",
    summary: "Index futures are firmer, but risk remains tied to the next CPI release and policy commentary."
  },
  {
    id: "n3",
    symbol: "TSLA",
    headline: "EV delivery revisions trigger short-term volatility watch",
    source: "Equity Wire",
    impact: "medium",
    timestamp: "07:55",
    summary: "Options flow suggests traders are preparing for a wider move around delivery commentary."
  },
  {
    id: "n4",
    symbol: "AMD",
    headline: "Peer read-through weighs on high beta chip watchlist",
    source: "Desk Notes",
    impact: "low",
    timestamp: "07:20",
    summary: "Relative weakness is visible against the broader semiconductor basket."
  }
];
