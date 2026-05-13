export type SymbolKey = "NVDA" | "AAPL" | "TSLA" | "MSFT" | "AMD" | "ETHUSD" | "EURUSD";

export type WatchSymbol = {
  symbol: SymbolKey;
  name: string;
  venue: string;
  last: number;
  change: number;
  changePercent: number;
  volume: string;
  marketCap?: string;
  nextEarnings?: string;
};

export type Candle = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type NewsItem = {
  id: string;
  symbol: SymbolKey | "MARKET";
  headline: string;
  source: string;
  impact: "high" | "medium" | "low";
  timestamp: string;
  summary: string;
};

export type JournalEntry = {
  id: string;
  symbol: SymbolKey;
  type: "trade" | "investment";
  side: "long" | "short";
  status: "open" | "closed" | "watching";
  entry: number;
  exit?: number;
  size: number;
  pnl: number;
  thesis: string;
  emotion: "calm" | "confident" | "rushed" | "fearful";
  tags: string[];
  createdAt: string;
};

export type StrategyRule = {
  id: string;
  name: string;
  timeframe: "15m" | "1h" | "4h" | "1D" | "1W";
  entry: string;
  exit: string;
  riskPercent: number;
  status: "draft" | "active" | "paused";
};

export type Holding = {
  id: string;
  symbol: SymbolKey;
  shares: number;
  averageCost: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AppState = {
  selectedSymbol: SymbolKey;
  journal: JournalEntry[];
  strategies: StrategyRule[];
  holdings: Holding[];
  chat: ChatMessage[];
};

export type SharedPortfolioSnapshot = {
  title: string;
  createdAt: string;
  holdings: Array<Holding & { last: number; value: number; gain: number; gainPercent: number }>;
  totalValue: number;
  totalGain: number;
  notes: string;
};
