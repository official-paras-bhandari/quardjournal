import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CandlestickSeries, createChart, HistogramSeries, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Brain,
  Camera,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Cpu,
  Crosshair,
  Download,
  Expand,
  Filter,
  Gauge,
  Grid2X2,
  History,
  Layers,
  LineChart,
  Maximize2,
  MessageSquare,
  PanelTop,
  Plus,
  Paperclip,
  Pin,
  Search,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  SquareTerminal,
  Target,
  Trash2,
  WalletCards,
  X,
  Zap,
  Globe,
  TrendingUp
} from "lucide-react";
import { candlesFor, news as fallbackNews, watchlist } from "@/data/mock";
import { analyzeMarket, chatAboutMarket, createContextAttachment, createMemory, deleteMemory, deletePortfolioItem as deletePortItem, fetchMemories, fetchPortfolio, savePortfolioItem as savePortItem, updateMemory, fetchJournal, saveJournalEntry as saveJournal, deleteJournalEntry, type MemoryItem, type JournalEntry } from "@/lib/ai";
import { fetchSession, login, logout, type AuthSession } from "@/lib/auth";
import { currency, number, signed } from "@/lib/format";
import { getMarketCandles, getMarketNews, getQuote, marketStreamUrl, type MarketQuote } from "@/lib/market";
import { TechnicalChart } from "@/components/technical-chart";
import type { Candle, Holding, NewsItem, SymbolKey, WatchSymbol } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type RouteKey = "dashboard" | "markets" | "intelligence" | "journal" | "portfolio" | "strategy" | "ai" | "settings";

const routes: Array<{ key: RouteKey; label: string; short: string; to: string; icon: typeof Grid2X2 }> = [
  { key: "dashboard", label: "Dashboard", short: "Dash", to: "/dashboard", icon: Grid2X2 },
  { key: "markets", label: "Chart", short: "Chart", to: "/markets", icon: LineChart },
  { key: "strategy", label: "Lab", short: "Lab", to: "/strategy", icon: ChartNoAxesCombined },
  { key: "journal", label: "Orders", short: "Orders", to: "/journal", icon: PanelTop },
  { key: "portfolio", label: "Portfolio", short: "Port", to: "/portfolio", icon: WalletCards },
  { key: "intelligence", label: "Markets", short: "Mkts", to: "/intelligence", icon: Activity },
  { key: "ai", label: "Chat", short: "Chat", to: "/ai", icon: Bot },
  { key: "settings", label: "Settings", short: "Set", to: "/settings", icon: Settings }
];

type AuditRow = [timestamp: string, ticker: string, side: string, price: string, duration: string, rr: string, tag: string, pnl: string, notes: string, id?: string];

function toAuditRow(entry: JournalEntry): AuditRow {
  return [entry.timestamp, entry.ticker, entry.side, entry.price, entry.duration, entry.rr, entry.tag, entry.pnl, entry.notes, entry.id];
}

function fromAuditRow(row: AuditRow): Partial<JournalEntry> {
  return { id: row[9], timestamp: row[0], ticker: row[1], side: row[2], price: row[3], duration: row[4], rr: row[5], tag: row[6], pnl: row[7], notes: row[8] };
}

const intelItems = [
  {
    type: "MACRO",
    time: "09:14:22 UTC",
    tone: "bullish",
    title: "Fed Chair Signals Potential Dovish Pivot in Q3",
    body: "Unexpected commentary from the FOMC minutes suggests a higher threshold for further rate hikes. Markets interpreting text as leaning towards a prolonged pause, with 68% probability of cuts by September priced into futures.",
    affected: "$SPY $QQQ $TLT",
    confidence: "88.4%",
    impact: "92/100",
    insight: "Cross-referencing historical FOMC pivots. Probability of $SPY upside capture within 48h of official confirmation is high."
  },
  {
    type: "EARNINGS",
    time: "08:45:01 UTC",
    tone: "bearish",
    title: "NVDA Supply Chain Constraints Reported by Primary Fab",
    body: "TSMC indicates potential yield issues on latest 3nm nodes affecting advanced AI accelerators. Sector-wide drag expected as hardware delivery timelines may slip by 1-2 quarters.",
    affected: "$NVDA $AMD $SMH",
    confidence: "76.2%",
    impact: "85/100",
    insight: "Generating deep analysis..."
  }
];

type ChatUiMessage = {
  id: string;
  type: "system" | "operator" | "analysis";
  text: string;
  activity?: string[];
  sources?: "web" | "local";
  memorySaved?: string[];
};

type ChatThread = {
  id: string;
  title: string;
  symbol: SymbolKey;
  messages: ChatUiMessage[];
  lastActive: number;
};

const timeframes = ["1m", "5m", "15m", "1H", "D", "1M", "1Y", "5Y", "MAX"] as const;

function useMarketData(symbol: SymbolKey, resolution = "D") {
  const fallback = useMemo(() => candlesFor(symbol), [symbol]);
  const [candles, setCandles] = useState<Candle[]>(fallback);
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [marketNews, setMarketNews] = useState<NewsItem[]>(fallbackNews.filter((item) => item.symbol === symbol || item.symbol === "MARKET"));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "connecting" | "subscribed" | "closed" | "error">("idle");

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    getMarketCandles(symbol, resolution).then((data) => {
      if (!active) return;
      if (data.length) setCandles(data);
    }).catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : "Market candles request failed.");
    }).finally(() => {
      if (!active) return;
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [resolution, symbol]);

  useEffect(() => {
    let active = true;
    setCandles(fallback);
    setMarketNews(fallbackNews.filter((item) => item.symbol === symbol || item.symbol === "MARKET"));
    setQuote(null);
    Promise.allSettled([getQuote(symbol), getMarketNews(symbol)]).then((results) => {
      if (!active) return;
      const [quoteResult, newsResult] = results;
      if (quoteResult.status === "fulfilled") setQuote(quoteResult.value);
      if (newsResult.status === "fulfilled" && newsResult.value.length) setMarketNews(newsResult.value);
    });
    return () => {
      active = false;
    };
  }, [fallback, symbol]);

  useEffect(() => {
    if (!stockSymbolsForLive.has(symbol)) {
      setStreamState("idle");
      return;
    }
    setStreamState("connecting");
    const source = new EventSource(marketStreamUrl(symbol));
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setStreamState(data.status ?? "idle");
    });
    source.addEventListener("trade", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setQuote((current) => {
        const previousClose = current?.previousClose ?? current?.last ?? data.last;
        return {
          symbol,
          last: Number(data.last),
          open: current?.open ?? Number(data.last),
          high: Math.max(current?.high ?? Number(data.last), Number(data.last)),
          low: Math.min(current?.low ?? Number(data.last), Number(data.last)),
          previousClose,
          change: Number(data.last) - previousClose,
          changePercent: previousClose ? ((Number(data.last) - previousClose) / previousClose) * 100 : 0,
          timestamp: Number(data.timestamp ?? Date.now()),
          source: "massive-stream"
        };
      });
    });
    source.addEventListener("candle", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Candle & { symbol: SymbolKey };
      setCandles((current) => {
        const next = { time: data.time, open: data.open, high: data.high, low: data.low, close: data.close, volume: data.volume };
        const prior = current.at(-1);
        if (prior?.time === next.time) return [...current.slice(0, -1), next];
        return [...current.slice(-499), next];
      });
    });
    source.addEventListener("error", () => {
      setStreamState("error");
    });
    return () => source.close();
  }, [symbol]);

  return { candles, quote, marketNews, isLoading, error, streamState };
}

function selectedQuote(symbol: SymbolKey, quote: MarketQuote | null): WatchSymbol {
  const listed = watchlist.find((item) => item.symbol === symbol) ?? watchlist[0];
  return quote ? { ...listed, last: quote.last, change: quote.change, changePercent: quote.changePercent } : listed;
}

const stockSymbolsForLive = new Set<SymbolKey>(["NVDA", "AAPL", "TSLA", "MSFT", "AMD"]);
const watchlistUniverse = watchlist;

function AuthLoadingScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background text-foreground">
      <div className="font-data text-xs uppercase tracking-[0.3em] text-muted-foreground">Checking session</div>
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = () => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    login(username.trim(), password).then((result) => {
      onAuthenticated({ authenticated: true, username: result.username });
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Login failed");
    }).finally(() => setIsSubmitting(false));
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm border border-border bg-card p-5 shadow-2xl">
        <div className="mb-6">
          <div className="font-data text-xs font-bold uppercase tracking-[0.35em] text-primary">QuantCore</div>
          <h1 className="mt-3 text-2xl font-black text-white">Secure Login</h1>
          <p className="mt-2 text-sm text-muted-foreground">Enter the production operator credentials.</p>
        </div>
        <div className="flex flex-col gap-3">
          <Input
            autoComplete="username"
            className="h-11 rounded-sm border-border bg-background font-data"
            placeholder="Login ID"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          <Input
            autoComplete="current-password"
            className="h-11 rounded-sm border-border bg-background font-data"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          {error ? <div className="border border-destructive/30 bg-destructive/10 p-3 text-xs text-red-200">{error}</div> : null}
          <Button className="h-11 rounded-sm font-bold uppercase tracking-[0.18em]" onClick={submit} disabled={isSubmitting || !username.trim() || !password}>
            {isSubmitting ? "Signing In" : "Enter Terminal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    fetchSession().then((current) => {
      setSession(current || { authenticated: true, username: "admin" });
      setAuthReady(true);
    });
    const expire = () => setSession(null);
    window.addEventListener("qj-auth-expired", expire);
    return () => window.removeEventListener("qj-auth-expired", expire);
  }, []);

  if (!authReady) {
    return <AuthLoadingScreen />;
  }

  if (!session) {
    return <LoginScreen onAuthenticated={(nextSession) => setSession(nextSession)} />;
  }

  return <AuthenticatedApp onLogout={() => setSession(null)} />;
}

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const [journalRows, setJournalRows] = useState<AuditRow[]>([]);
  const [portfolioRows, setPortfolioRows] = useState<Holding[]>([]);
  const [watchlistRows, setWatchlistRows] = useState<WatchSymbol[]>(watchlist);
  const [quotesBySymbol, setQuotesBySymbol] = useState<Partial<Record<SymbolKey, MarketQuote>>>({});
  const [dashboardSymbol, setDashboardSymbol] = useState<SymbolKey>(watchlist[0].symbol);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Sync AI thread with Dashboard symbol if needed
  useEffect(() => {
    if (activeThreadId) {
      const active = chatThreads.find(t => t.id === activeThreadId);
      if (active && active.symbol !== dashboardSymbol) {
        setDashboardSymbol(active.symbol);
      }
    }
  }, [activeThreadId]);

  const handleGlobalSymbolChange = (s: SymbolKey) => {
    setDashboardSymbol(s);
    // Also find or create AI thread for this symbol
    const existing = chatThreads.find(t => t.symbol === s);
    if (existing) {
      setActiveThreadId(existing.id);
    } else setActiveThreadId(`new-${s}-${Date.now()}`);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("qj_chat_threads");
      const parsed = saved ? JSON.parse(saved) as ChatThread[] : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setChatThreads(parsed);
        setActiveThreadId(parsed[0].id);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (chatThreads.length > 0) {
      localStorage.setItem("qj_chat_threads", JSON.stringify(chatThreads));
    }
  }, [chatThreads]);
  useEffect(() => {
    fetchJournal().then(entries => {
      setJournalRows(entries.map(toAuditRow));
    }).catch(() => {
      try {
        const saved = localStorage.getItem("qj_journal");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setJournalRows(parsed);
        }
      } catch { /* ignore */ }
    });
  }, []);
  useEffect(() => {
    fetchPortfolio().then(setPortfolioRows).catch(() => {
      try {
        const saved = localStorage.getItem("qj_portfolio");
        if (saved) setPortfolioRows(JSON.parse(saved));
      } catch { /* ignore */ }
    });
  }, []);

  useEffect(() => {
    const refreshQuotes = () => {
      Promise.allSettled(
        watchlistRows
          .filter((item) => stockSymbolsForLive.has(item.symbol))
          .map((item) => getQuote(item.symbol))
      ).then((results) => {
        const nextQuotes: Partial<Record<SymbolKey, MarketQuote>> = {};
        for (const result of results) {
          if (result.status === "fulfilled") nextQuotes[result.value.symbol] = result.value;
        }
        if (Object.keys(nextQuotes).length) {
          setQuotesBySymbol((current) => ({ ...current, ...nextQuotes }));
        }
      });
    };
    refreshQuotes();
    const timer = setInterval(refreshQuotes, 30_000);
    return () => clearInterval(timer);
  }, [watchlistRows]);

  const liveWatchlist = useMemo(() => {
    return watchlistRows.map((item) => {
      const quote = quotesBySymbol[item.symbol];
      if (quote) {
        return {
          ...item,
          last: quote.last,
          change: quote.change,
          changePercent: quote.changePercent
        };
      }
      return item;
    });
  }, [quotesBySymbol, watchlistRows]);

  useEffect(() => {
    if (!watchlistRows.length) return;
    if (!watchlistRows.some((item) => item.symbol === dashboardSymbol)) {
      setDashboardSymbol(watchlistRows[0].symbol);
    }
  }, [dashboardSymbol, watchlistRows]);

  const addWatchSymbol = (symbol: SymbolKey) => {
    const existing = watchlistRows.some((item) => item.symbol === symbol);
    const template = watchlist.find((item) => item.symbol === symbol);
    if (existing || !template) return;
    const quote = quotesBySymbol[symbol];
    setWatchlistRows((current) => [
      ...current,
      quote ? { ...template, last: quote.last, change: quote.change, changePercent: quote.changePercent } : template
    ]);
  };

  const removeWatchSymbol = (symbol: SymbolKey) => {
    setWatchlistRows((current) => current.filter((item) => item.symbol !== symbol));
  };

  const addJournalEntry = (row: AuditRow) => {
    saveJournal(fromAuditRow(row)).then((saved) => {
      setJournalRows((prev) => {
        const next = [toAuditRow(saved), ...prev];
        try { localStorage.setItem("qj_journal", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }).catch(console.error);
  };

  const updateJournalEntry = (index: number, row: AuditRow) => {
    saveJournal(fromAuditRow(row)).then((saved) => {
      setJournalRows((prev) => {
        const next = prev.map((current, currentIndex) => currentIndex === index ? toAuditRow(saved) : current);
        try { localStorage.setItem("qj_journal", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }).catch(console.error);
  };

  const addPortfolioHolding = (holding: Omit<Holding, "id">) => {
    savePortItem(holding).then((saved) => {
      setPortfolioRows((prev) => {
        const next = [saved, ...prev];
        try { localStorage.setItem("qj_portfolio", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }).catch(console.error);
  };

  const updatePortfolioHolding = (id: string, patch: Partial<Holding>) => {
    savePortItem({ id, ...patch }).then((saved) => {
      setPortfolioRows((prev) => {
        const next = prev.map((holding) => holding.id === id ? { ...holding, ...saved } : holding);
        try { localStorage.setItem("qj_portfolio", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }).catch(console.error);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<TerminalShell active="dashboard" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><DashboardPage journal={journalRows} portfolio={portfolioRows} onAddTrade={addJournalEntry} watchlist={liveWatchlist} selectedSymbol={dashboardSymbol} onSelectSymbol={setDashboardSymbol} onAddWatchSymbol={addWatchSymbol} onRemoveWatchSymbol={removeWatchSymbol} onClearWatchlist={() => setWatchlistRows([])} /></TerminalShell>} />
        <Route path="/markets" element={<TerminalShell active="markets" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><MarketsPage portfolio={portfolioRows} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/intelligence" element={<TerminalShell active="intelligence" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><IntelligencePage watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/journal" element={<TerminalShell active="journal" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><JournalPage rows={journalRows} onAddTrade={addJournalEntry} onUpdateTrade={updateJournalEntry} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/portfolio" element={<TerminalShell active="portfolio" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><PortfolioPage rows={portfolioRows} onAddHolding={addPortfolioHolding} onUpdateHolding={updatePortfolioHolding} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/strategy" element={<TerminalShell active="strategy" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><StrategyPage watchlist={liveWatchlist} onAddTrade={addJournalEntry} /></TerminalShell>} />
        <Route path="/ai" element={
          <TerminalShell active="ai" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}>
            <AiPage 
              watchlist={liveWatchlist} 
              portfolio={portfolioRows}
              threads={chatThreads} 
              activeThreadId={activeThreadId}
              onSwitchThread={setActiveThreadId}
              onUpdateThreads={setChatThreads}
            />
          </TerminalShell>
        } />
        <Route path="/settings" element={<TerminalShell active="settings" symbol={dashboardSymbol} onSymbolChange={handleGlobalSymbolChange} watchlist={liveWatchlist} onLogout={onLogout}><SettingsPage /></TerminalShell>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function TerminalShell({ 
  children, 
  active, 
  symbol, 
  onSymbolChange, 
  watchlist,
  onLogout
}: { 
  children: React.ReactNode; 
  active: RouteKey; 
  symbol?: SymbolKey;
  onSymbolChange?: (s: SymbolKey) => void;
  watchlist?: WatchSymbol[];
  onLogout: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);

  const filtered = watchlist?.filter(w => 
    w.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5) || [];

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground selection:bg-primary/30">
      <SideRail active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-start gap-8 border-b border-border bg-[#050505] px-6 max-md:gap-4 max-md:px-4">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]" />
            <span className="text-lg font-black uppercase tracking-tighter text-white max-md:hidden">Quant<span className="text-primary">Core</span></span>
          </div>
          
          {symbol ? (
            <div className="flex items-center gap-4 border-l border-border pl-8 max-md:hidden">
              <span className="label-caps opacity-50">Active Asset</span>
              <span className="font-data text-lg font-bold text-white">${symbol}</span>
              <Badge variant="outline" className="rounded-sm"><span className="mr-1 size-1.5 rounded-full bg-primary animate-pulse" />Live</Badge>
            </div>
          ) : null}

          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <Input 
              className="h-9 rounded-sm border-border bg-background pl-10 font-data text-sm focus:border-primary/50" 
              placeholder="Search instrument or research vector..." 
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
            />
            
            {showResults && searchQuery && (
              <div className="absolute top-full z-50 mt-1 w-full border border-border bg-card/95 p-1 shadow-2xl backdrop-blur-xl">
                {searchQuery.length >= 2 && !watchlist?.some(w => w.symbol.toLowerCase() === searchQuery.toLowerCase()) && (
                  <div 
                    className="flex cursor-pointer items-center justify-between rounded-sm px-3 py-3 border-b border-border/50 bg-primary/5 hover:bg-primary/20 text-white"
                    onClick={() => {
                      onSymbolChange?.(searchQuery.toUpperCase() as SymbolKey);
                      setSearchQuery("");
                      setShowResults(false);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-6 flex items-center justify-center rounded-full bg-primary/20"><Globe className="size-3 text-primary" /></div>
                      <div className="flex flex-col">
                        <span className="font-data font-bold">Research Global Market for ${searchQuery.toUpperCase()}</span>
                        <span className="text-[9px] text-primary uppercase tracking-widest">Live Dynamic Fetch</span>
                      </div>
                    </div>
                    <Zap className="size-3 text-primary animate-pulse" />
                  </div>
                )}
                {filtered.length > 0 ? filtered.map(item => (
                  <div 
                    key={item.symbol}
                    className="flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 hover:bg-primary/10 hover:text-white"
                    onClick={() => {
                      onSymbolChange?.(item.symbol);
                      setSearchQuery("");
                      setShowResults(false);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-data font-bold">${item.symbol}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{item.name}</span>
                    </div>
                    <span className={cn("font-data text-[10px]", item.change >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {item.changePercent.toFixed(2)}%
                    </span>
                  </div>
                )) : searchQuery.length < 2 && (
                  <div className="p-4 text-center text-xs text-muted-foreground italic">Enter ticker or name...</div>
                )}
              </div>
            )}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-zinc-500">
              CMD+K
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <StatusPill />
            <IconOnly icon={Bell} label="Alerts" />
            <Button
              variant="ghost"
              size="icon-sm"
              title="Sign out"
              onClick={() => logout().finally(onLogout)}
            >
              <CircleUserRound data-icon="icon" />
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden max-md:overflow-auto">
          {children}
        </main>
        <FooterBar />
      </div>
    </div>
  );
}

function SideRail({ active }: { active: RouteKey }) {
  const location = useLocation();
  return (
    <aside className="flex w-20 shrink-0 flex-col items-center border-r border-border bg-[#030303] max-md:hidden">
      <div className="flex h-[60px] w-full items-center justify-center border-b border-border">
        <div className="flex size-10 items-center justify-center rounded-md border border-border bg-card font-data font-bold text-primary">QJ</div>
      </div>
      <nav className="flex w-full flex-1 flex-col items-center gap-3 py-8">
        {routes.filter((item) => item.key !== "settings").map(({ key, to, icon: Icon, short }) => {
          const selected = active === key || location.pathname === to;
          return (
            <Button key={key} asChild variant="ghost" className={cn("relative h-[60px] w-full flex-col gap-1 rounded-none text-muted-foreground hover:text-white", selected && "bg-muted text-white before:absolute before:left-0 before:top-0 before:h-full before:w-0.5 before:bg-primary")}>
              <NavLink to={to}>
                <Icon data-icon="icon" />
                <span className="text-[10px] font-bold uppercase">{short}</span>
              </NavLink>
            </Button>
          );
        })}
      </nav>
      <div className="flex w-full flex-col items-center gap-3 p-3">
        <Button asChild variant="ghost" size="icon" className={cn(active === "ai" && "bg-muted text-primary")}>
          <NavLink to="/ai"><Bot data-icon="icon" /></NavLink>
        </Button>
        <Button asChild variant="ghost" size="icon" className={cn(active === "settings" && "bg-muted text-primary")}>
          <NavLink to="/settings"><SlidersHorizontal data-icon="icon" /></NavLink>
        </Button>
      </div>
    </aside>
  );
}

function DashboardPage({
  journal,
  portfolio,
  onAddTrade,
  watchlist,
  selectedSymbol,
  onSelectSymbol,
  onAddWatchSymbol,
  onRemoveWatchSymbol,
  onClearWatchlist
}: {
  journal: AuditRow[];
  portfolio: Holding[];
  onAddTrade: (row: AuditRow) => void;
  watchlist: WatchSymbol[];
  selectedSymbol: SymbolKey;
  onSelectSymbol: (symbol: SymbolKey) => void;
  onAddWatchSymbol: (symbol: SymbolKey) => void;
  onRemoveWatchSymbol: (symbol: SymbolKey) => void;
  onClearWatchlist: () => void;
}) {
  const totalValue = portfolio.reduce((sum, h) => {
    const quote = watchlist.find((item) => item.symbol === h.symbol);
    return sum + h.shares * (quote?.last ?? h.averageCost);
  }, 0);
  const totalCost = portfolio.reduce((sum, h) => sum + h.shares * h.averageCost, 0);
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost ? (pnl / totalCost) * 100 : 0;

  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-rows-[150px_minmax(0,1fr)_220px] xl:overflow-hidden max-md:p-3">
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard title="Portfolio Value" value={currency(totalValue)} meta={signed(pnlPct, "%")} details={[["Sharpe", "N/A"], ["Beta (SPX)", "0.88"]]} accent="green" />
        <KpiCard title="Total P&L" value={currency(pnl)} meta="Unrealized" details={[["Max Drawdown", "0.0%"], ["Daily VAR", "$0"]]} accent="primary" />
        <KpiCard title="Risk Management" value="0.0%" meta="Utilization" details={[["Volatility (ATR)", "0.00"], ["Margin Level", "Nominal"]]} />
        <KpiCard title="Active Exposure" value={`${portfolio.length} Positions`} meta={`${portfolio.filter(p => p.shares > 0).length} Long`} details={[["Net Delta", "0.0"], ["Avg Holding", "0.0d"]]} />
      </div>
      <div className="grid min-h-0 grid-cols-[420px_minmax(0,1fr)_320px] gap-4 max-xl:grid-cols-1">
        <WatchlistMatrix
          watchlist={watchlist}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={onSelectSymbol}
          onAdd={onAddWatchSymbol}
          onRemove={onRemoveWatchSymbol}
          onClear={onClearWatchlist}
        />
        <DashboardChartPanel symbol={selectedSymbol} watchlist={watchlist} onSymbolChange={onSelectSymbol} />
        <div className="flex flex-col gap-4">
          <QuickAddTrade onAdd={onAddTrade} watchlist={watchlist} />
          <OrderDepth />
        </div>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4 max-xl:grid-cols-1">
        <ManagedPositions portfolio={portfolio} watchlist={watchlist} />
        <Panel className="flex flex-col p-3">
          <PanelTitle title="Terminal Health" />
          <div className="mt-4 flex flex-1 flex-col gap-3">
            <MetricInline label="Massive REST" value="Online" />
            <MetricInline label="Stream Engine" value="Subscribed" />
            <MetricInline label="AI Latency" value="142ms" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function QuickAddTrade({ onAdd, watchlist }: { onAdd: (row: AuditRow) => void; watchlist: WatchSymbol[] }) {
  const [ticker, setTicker] = useState("NVDA");
  const [side, setSide] = useState("BUY");
  const selectedTicker = watchlist.some((item) => item.symbol === ticker) ? ticker : watchlist[0]?.symbol;
  const hasSymbols = Boolean(selectedTicker);

  const execute = () => {
    if (!selectedTicker) return;
    const selected = watchlist.find((item) => item.symbol === selectedTicker) ?? watchlist[0];
    onAdd([
      new Date().toISOString().slice(0, 19).replace("T", " "),
      selectedTicker,
      side,
      number(selected.last),
      "0s",
      "1.0",
      "#QUICK",
      side === "BUY" ? "+$0.00" : "-$0.00",
      "quick_dashboard_execution"
    ]);
  };

  return (
    <Panel className="p-4">
      <PanelTitle title="Quick Add Trade" action={<Zap className="size-3 text-primary" />} />
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select value={selectedTicker} onValueChange={setTicker} disabled={!hasSymbols}>
            <SelectTrigger className="h-8 rounded-sm bg-background font-data text-xs">
              <SelectValue placeholder="No symbols" />
            </SelectTrigger>
            <SelectContent>
              {watchlist.map((item) => <SelectItem key={item.symbol} value={item.symbol}>{item.symbol}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={side} onValueChange={setSide}>
            <SelectTrigger className="h-8 rounded-sm bg-background font-data text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BUY">BUY</SelectItem>
              <SelectItem value="SELL">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input placeholder="Size / Price" className="h-8 rounded-sm bg-background font-data text-xs" />
        <Button onClick={execute} disabled={!hasSymbols} className="h-8 w-full rounded-sm text-[10px] font-bold uppercase tracking-widest">Execute Intent</Button>
      </div>
    </Panel>
  );
}

function WatchlistMatrix({
  watchlist,
  selectedSymbol,
  onSelectSymbol,
  onAdd,
  onRemove,
  onClear
}: {
  watchlist: WatchSymbol[];
  selectedSymbol: SymbolKey;
  onSelectSymbol: (symbol: SymbolKey) => void;
  onAdd: (symbol: SymbolKey) => void;
  onRemove: (symbol: SymbolKey) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const available = watchlist.length === 0
    ? watchlistUniverse
    : watchlistUniverse.filter((item) => !watchlist.some((row) => row.symbol === item.symbol));
  const filteredRows = watchlist.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
  });
  const filteredAvailable = available.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
  });
  const [pendingSymbol, setPendingSymbol] = useState<SymbolKey>(filteredAvailable[0]?.symbol ?? available[0]?.symbol ?? "NVDA");
  const addDisabled = !available.some((item) => item.symbol === pendingSymbol);

  useEffect(() => {
    if (!available.some((item) => item.symbol === pendingSymbol)) {
      setPendingSymbol(available[0]?.symbol ?? "NVDA");
    }
  }, [available, pendingSymbol]);

  useEffect(() => {
    if (!filteredAvailable.some((item) => item.symbol === pendingSymbol)) {
      setPendingSymbol(filteredAvailable[0]?.symbol ?? available[0]?.symbol ?? "NVDA");
    }
  }, [available, filteredAvailable, pendingSymbol]);

  const commitSearch = () => {
    const exact = watchlistUniverse.find((item) => item.symbol.toLowerCase() === search.trim().toLowerCase());
    if (!exact) return;
    if (watchlist.some((row) => row.symbol === exact.symbol)) {
      onSelectSymbol(exact.symbol);
      return;
    }
    onAdd(exact.symbol);
    onSelectSymbol(exact.symbol);
  };

  return (
    <Panel className="min-h-0">
      <PanelTitle
        title="Technical Watchlist"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitSearch();
                }}
                placeholder="Search"
                className="h-8 w-[120px] rounded-sm border-border bg-background pl-7 font-data text-xs"
              />
            </div>
            <Select value={pendingSymbol} onValueChange={(value) => setPendingSymbol(value as SymbolKey)} disabled={!available.length}>
              <SelectTrigger className="h-8 w-[92px] rounded-sm bg-background font-data text-xs">
                <SelectValue placeholder="Add" />
              </SelectTrigger>
              <SelectContent>
                {filteredAvailable.map((item) => <SelectItem key={item.symbol} value={item.symbol}>{item.symbol}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" onClick={() => onAdd(pendingSymbol)} disabled={addDisabled}>
              <Plus data-icon="icon" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear} disabled={!watchlist.length} className="h-8 rounded-sm px-2 text-[10px] uppercase tracking-widest text-red-200">
              Clear
            </Button>
          </div>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Vol (24h)</TableHead>
            <TableHead className="text-right">RSI</TableHead>
            <TableHead className="text-right">Tools</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-xs uppercase tracking-widest text-muted-foreground">
                {watchlist.length === 0 ? "Watchlist empty. Add a symbol above." : "No matching symbols."}
              </TableCell>
            </TableRow>
          ) : filteredRows.map((item) => (
            <TableRow key={item.symbol} className={cn(item.symbol === selectedSymbol && "bg-primary/10")} onClick={() => onSelectSymbol(item.symbol)}>
              <TableCell>
                <div className="font-data font-bold text-white">{item.symbol}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.name}</div>
              </TableCell>
              <TableCell className="text-right font-data">
                {number(item.last)}
                <div className={cn("text-xs", item.changePercent >= 0 ? "text-emerald-400" : "text-red-300")}>{signed(item.changePercent, "%")}</div>
              </TableCell>
              <TableCell className="text-right font-data text-muted-foreground">{item.volume}</TableCell>
              <TableCell className={cn("text-right font-data font-bold", item.changePercent < 0 ? "text-red-300" : "text-white")}>{Math.abs(Math.round(item.changePercent * 13 + 50))}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon-xs" onClick={() => onRemove(item.symbol)}>
                  <X data-icon="icon" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function TradeChartPanel({ symbol = "AAPL", candles = candlesFor(symbol), quote, resolution, onResolutionChange, onSymbolChange, onAnalyze, isAnalyzing, analysis, dataError, streamState }: {
  symbol?: SymbolKey;
  candles?: Candle[];
  quote?: MarketQuote | null;
  resolution?: string;
  onResolutionChange?: (resolution: string) => void;
  onSymbolChange?: (symbol: SymbolKey) => void;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  analysis?: string | null;
  dataError?: string | null;
  streamState?: string;
}) {
  return (
    <Panel className="relative min-h-0 overflow-hidden">
      <TechnicalChart
        symbol={symbol}
        candles={candles}
        quote={quote ? selectedQuote(symbol, quote) : null}
        resolution={resolution ?? "D"}
        onResolutionChange={onResolutionChange ?? (() => undefined)}
        onSymbolChange={onSymbolChange ?? (() => undefined)}
        onAnalyze={onAnalyze}
        isAnalyzing={isAnalyzing}
        analysis={analysis}
        streamState={streamState}
        dataError={dataError}
      />
    </Panel>
  );
}

// Dashboard-specific chart panel: fetches real candles & quote for selected symbol
function DashboardChartPanel({ symbol, watchlist, onSymbolChange }: { symbol: SymbolKey; watchlist: WatchSymbol[]; onSymbolChange: (symbol: SymbolKey) => void }) {
  const [resolution, setResolution] = useState<string>("D");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { candles, quote, marketNews, error, streamState } = useMarketData(symbol, resolution);

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);
    try {
      const selected = selectedQuote(symbol, quote);
      const result = await analyzeMarket({ symbol, quote: selected, candles, news: marketNews });
      setAnalysis(result.content);
    } catch (err) {
      setAnalysis(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <TradeChartPanel
      symbol={symbol}
      candles={candles}
      quote={quote}
      resolution={resolution}
      onResolutionChange={setResolution}
      onSymbolChange={onSymbolChange}
      onAnalyze={runAnalysis}
      isAnalyzing={isAnalyzing}
      analysis={analysis}
      dataError={error}
      streamState={streamState}
    />
  );
}

function StockChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      crosshair: { mode: 1 },
      autoSize: true
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fca5a5",
      borderUpColor: "#34d399",
      borderDownColor: "#fca5a5",
      wickUpColor: "#34d399",
      wickDownColor: "#fca5a5"
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: "rgba(192,193,255,0.28)"
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const priceData: CandlestickData[] = candles.map((item) => ({
      time: item.time as Time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }));
    const volumeData: HistogramData[] = candles.map((item) => ({
      time: item.time as Time,
      value: item.volume,
      color: item.close >= item.open ? "rgba(52,211,153,0.24)" : "rgba(252,165,165,0.24)"
    }));
    candleSeriesRef.current?.setData(priceData);
    volumeSeriesRef.current?.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="h-full min-h-[320px] w-full" />;
}

function MarketSvg({ compact = false }: { compact?: boolean }) {
  return (
    <svg viewBox="0 0 1000 430" className="h-full w-full" role="img" aria-label="Market price chart">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c0c1ff" stopOpacity=".18" />
          <stop offset="100%" stopColor="#c0c1ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[80, 150, 220, 290, 360].map((y) => <line key={y} x1="40" x2="960" y1={y} y2={y} stroke="#18181b" />)}
      <path d="M60 350 C120 180 140 270 190 210 C250 115 310 180 350 130 C430 220 500 150 570 240 C650 160 700 300 760 250 C840 190 890 250 950 210" fill="none" stroke="#777" strokeWidth="4" opacity=".55" />
      <path d="M90 360 C200 320 300 330 420 260 C510 220 620 280 700 260 C820 235 890 220 970 215" fill="none" stroke="#c0c1ff" strokeWidth={compact ? 3 : 2} opacity=".75" />
      <path d="M90 360 C200 320 300 330 420 260 C510 220 620 280 700 260 C820 235 890 220 970 215 L970 405 L90 405 Z" fill="url(#area)" />
      {Array.from({ length: compact ? 0 : 34 }).map((_, i) => {
        const x = 92 + i * 16;
        const up = i % 3 !== 0;
        const h = 32 + ((i * 13) % 80);
        const y = 330 - ((i * 19) % 120);
        return <g key={i}><line x1={x} x2={x} y1={y - 18} y2={y + h} stroke={up ? "#1fd58f" : "#ff9c9c"} opacity=".35" /><rect x={x - 4} y={y} width="8" height={h} fill={up ? "#1fd58f" : "#ff9c9c"} opacity=".58" /></g>;
      })}
    </svg>
  );
}

function ManagedPositions({ portfolio, watchlist }: { portfolio: Holding[]; watchlist: WatchSymbol[] }) {
  const holdings = useMemo(() => portfolio.map((holding) => {
    const quote = watchlist.find((item) => item.symbol === holding.symbol) ?? watchlist[0];
    const value = holding.shares * quote.last;
    const pnl = value - holding.shares * holding.averageCost;
    return { ...holding, last: quote.last, value, pnl };
  }), [portfolio, watchlist]);

  return (
    <Panel className="min-h-0">
      <PanelTitle title="Managed Positions" action={<div className="flex gap-4 text-xs uppercase text-muted-foreground"><span><Filter className="mr-1 inline size-3" />Filter</span><span className="text-red-200">Close All</span></div>} />
      <Table>
        <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Avg Entry</TableHead><TableHead className="text-right">Current</TableHead><TableHead className="text-right">Unrealized P&L</TableHead><TableHead className="text-right">Tools</TableHead></TableRow></TableHeader>
        <TableBody>
          {holdings.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-data font-bold text-white">{row.symbol}</TableCell>
              <TableCell><Badge variant="outline" className="rounded-none font-data border-emerald-500/40 text-emerald-400">LONG</Badge></TableCell>
              <TableCell className="text-right font-data">{number(row.shares)}</TableCell>
              <TableCell className="text-right font-data">{currency(row.averageCost)}</TableCell>
              <TableCell className="text-right font-data">{currency(row.last)}</TableCell>
              <TableCell className={cn("text-right font-data font-bold", row.pnl >= 0 ? "text-emerald-400" : "text-red-200")}>{currency(row.pnl)}</TableCell>
              <TableCell className="text-right"><Button variant="ghost" size="icon-xs"><Target data-icon="icon" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function OrderDepth() {
  return (
    <Panel>
      <PanelTitle title="Order Depth (L2)" action={<span className="font-data text-xs text-emerald-400"><span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />Live</span>} />
      <div className="p-3">
        {[
          ["173.68", "92%", "2,410"],
          ["173.65", "68%", "1,200"],
          ["173.60", "88%", "450"]
        ].map(([price, width, size]) => (
          <div key={price} className="relative mb-1 h-8 border border-border bg-red-950/20">
            <div className="absolute right-0 top-0 h-full bg-red-200/20" style={{ width }} />
            <div className="relative flex h-full items-center justify-between px-3 font-data text-sm"><span className="text-red-200">{price}</span><span>{size}</span></div>
          </div>
        ))}
        <div className="mt-3 border border-border bg-card p-4 text-center">
          <div className="font-data text-lg font-bold text-white">173.50</div>
          <div className="label-caps mt-1">Spread: 0.04</div>
        </div>
      </div>
    </Panel>
  );
}

function MarketsPage({ portfolio, watchlist }: { portfolio: Holding[]; watchlist: WatchSymbol[] }) {
  const [symbol, setSymbol] = useState<SymbolKey>("NVDA");
  const [resolution, setResolution] = useState<string>("D");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { candles, quote, marketNews, isLoading, error, streamState } = useMarketData(symbol, resolution);
  const selected = selectedQuote(symbol, quote);
  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await analyzeMarket({ symbol, quote: selected, candles, news: marketNews });
      setAnalysis(result.content);
    } catch (err) {
      setAnalysis(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-cols-[360px_minmax(0,1fr)] xl:overflow-hidden max-md:p-3">
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_244px] gap-4">
        <Panel className="min-h-0">
          <PanelTitle title="Symbol Universe" action={<Badge variant="outline" className="rounded-sm">{isLoading ? "Syncing" : "Ready"}</Badge>} />
          <div className="border-b border-border p-3">
            <Select value={symbol} onValueChange={(value) => { setSymbol(value as SymbolKey); setAnalysis(null); }}>
              <SelectTrigger className="h-10 w-full rounded-sm border-border bg-background font-data">
                <SelectValue placeholder="Select stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {watchlist.map((item) => (
                    <SelectItem key={item.symbol} value={item.symbol}>
                      {item.symbol} - {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Move</TableHead></TableRow></TableHeader>
            <TableBody>
              {watchlist.map((item) => {
                const active = item.symbol === symbol;
                return (
                  <TableRow key={item.symbol} className={cn(active && "bg-primary/10")} onClick={() => { setSymbol(item.symbol); setAnalysis(null); }}>
                    <TableCell><div className="font-data font-bold text-white">{item.symbol}</div><div className="mt-1 text-xs text-muted-foreground">{item.venue}</div></TableCell>
                    <TableCell className="text-right font-data">{number(active ? selected.last : item.last)}</TableCell>
                    <TableCell className={cn("text-right font-data", (active ? selected.changePercent : item.changePercent) >= 0 ? "text-emerald-300" : "text-red-200")}>{signed(active ? selected.changePercent : item.changePercent, "%")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
        <OrderDepth />
      </div>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_244px] gap-4">
        <TradeChartPanel symbol={symbol} candles={candles} quote={quote} resolution={resolution} onResolutionChange={setResolution} onSymbolChange={setSymbol} onAnalyze={runAnalysis} isAnalyzing={isAnalyzing} analysis={analysis} dataError={error} streamState={streamState} />
        <ManagedPositions portfolio={portfolio} watchlist={watchlist} />
      </div>
    </div>
  );
}

const labResolutionMap: Record<string, string> = { 
  "1m": "1", 
  "5m": "5", 
  "1h": "60", 
  "1d": "D", 
  "1M": "M", 
  "1Y": "12M", 
  "5Y": "60M", 
  "MAX": "MAX" 
};

function LabPage({ watchlist, onAddTrade }: { watchlist: WatchSymbol[]; onAddTrade: (row: AuditRow) => void }) {
  const [ticker, setTicker] = useState<SymbolKey>("NVDA");
  const [tfLabel, setTfLabel] = useState("5m");
  const resolution = labResolutionMap[tfLabel] ?? "5";
  const [simulationRows, setSimulationRows] = useState<AuditRow[]>([]);

  const { candles, isLoading } = useMarketData(ticker, resolution);

  const rvol = useMemo(() => {
    if (candles.length < 6) return 1.0;
    const recent = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
    const hist = candles.slice(-25, -5);
    const base = hist.length ? hist.reduce((s, c) => s + c.volume, 0) / hist.length : 1;
    return base > 0 ? recent / base : 1.0;
  }, [candles]);

  const profitFactor = useMemo(() => {
    const nums = simulationRows.map((r) => parseFloat(r[7].replace(/[^0-9.-]/g, ""))).filter((n) => !isNaN(n));
    const gains = nums.filter((n) => n > 0).reduce((s, n) => s + n, 0);
    const losses = Math.abs(nums.filter((n) => n < 0).reduce((s, n) => s + n, 0));
    if (losses === 0) return gains > 0 ? 99 : 0;
    return gains / losses;
  }, [simulationRows]);

  const addSimulation = (row: AuditRow) => {
    setSimulationRows((prev) => [row, ...prev]);
    onAddTrade(row);
  };

  const exportCsv = () => {
    const headers = ["Timestamp", "Ticker", "Side", "Price", "Duration", "R:R", "Tag", "P&L", "Notes"];
    const lines = simulationRows.map((r) => r.map((cell) => `"${cell}"`).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sim-${ticker}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-cols-[420px_minmax(0,1fr)] xl:overflow-hidden max-md:p-3">
      <StrategyConfig ticker={ticker} onTickerChange={setTicker} onRunSimulation={addSimulation} watchlist={watchlist} />
      <div className="grid min-h-0 gap-4 xl:grid-rows-[minmax(0,1fr)_360px]">
        <Panel className="min-h-0">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <ToggleGroup type="single" value={tfLabel} onValueChange={(v) => v && setTfLabel(v)} className="rounded-sm border border-border bg-background">
              {["1m", "5m", "15m", "1h", "1d", "1M", "1Y", "5Y", "MAX"].map((item) => <ToggleGroupItem key={item} value={item} className="rounded-sm font-data text-xs uppercase">{item}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="flex items-center gap-5 font-data text-sm">
              <span>RVOL: {rvol.toFixed(2)}</span>
              <span className="text-emerald-400">Profit Factor: {profitFactor === 99 ? "∞" : profitFactor.toFixed(2)}</span>
              <Maximize2 className="size-4 cursor-pointer" />
              <Camera className="size-4 cursor-pointer" />
            </div>
          </div>
          <div className="h-[calc(100%-48px)]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center font-data text-sm text-muted-foreground">Loading {ticker}…</div>
            ) : (
              <LabCandleChart candles={candles} />
            )}
          </div>
        </Panel>
        <Panel>
          <PanelTitle title="Simulation Runs" action={<Button variant="outline" size="sm" onClick={exportCsv} disabled={simulationRows.length === 0}>Export CSV</Button>} />
          <AuditTable compact rows={simulationRows} />
        </Panel>
      </div>
    </div>
  );
}

function StrategyConfig({
  ticker,
  onTickerChange,
  onRunSimulation,
  watchlist
}: {
  ticker: SymbolKey;
  onTickerChange: (t: SymbolKey) => void;
  onRunSimulation: (row: AuditRow) => void;
  watchlist: WatchSymbol[];
}) {
  const [ema, setEma] = useState([9]);
  const [rvol, setRvol] = useState([1.5]);
  const [risk, setRisk] = useState([500]);
  const [correlation, setCorrelation] = useState([82]);
  const [atr, setAtr] = useState([2]);
  const [scenario, setScenario] = useState({
    name: "VWAP Retest",
    entry: "VWAP reclaim with RSI divergence",
    exit: "Trim at 2R, invalidate below anchor low"
  });
  const selected = watchlist.find((item) => item.symbol === ticker) ?? watchlist[0];
  const positionSize = useMemo(() => {
    const price = selected?.last ?? 1;
    return Math.max(1, Math.floor(risk[0] / (price * 0.01 * atr[0])));
  }, [risk, atr, selected?.last]);

  const runSimulation = () => {
    onRunSimulation([
      new Date().toISOString().slice(0, 19).replace("T", " "),
      ticker,
      "BUY",
      number(selected.last),
      "SIM",
      (risk[0] / 250).toFixed(1),
      `#${scenario.name.trim().replace(/\s+/g, "-").toUpperCase() || "SIM"}`,
      `+$${Math.round(risk[0] * rvol[0]).toLocaleString()}.00`,
      `${scenario.entry}; ${scenario.exit}; ema_${ema[0]}_21; rvol_${rvol[0].toFixed(1)}`
    ]);
  };

  return (
    <Panel className="flex min-h-[640px] flex-col xl:min-h-0">
      <div className="border-b border-border p-4">
        <h1 className="text-xl font-bold text-white">Equity Strategy Lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">Institutional-grade stock model config</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-4 pb-8">
          <ConfigGroup title="Asset Target">
            <label className="label-caps">Stock Ticker</label>
            <Select value={ticker} onValueChange={(v) => onTickerChange(v as SymbolKey)}>
              <SelectTrigger className="h-10 w-full rounded-sm border-border bg-background font-data">
                <SelectValue placeholder="Select watchlist stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {watchlist.map((item) => (
                    <SelectItem key={item.symbol} value={item.symbol}>
                      {item.symbol} — {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <TradeField label="Scenario Name" value={scenario.name} onChange={(name) => setScenario({ ...scenario, name })} />
          </ConfigGroup>
          <ConfigGroup title="Simulation Notes">
            <div>
              <div className="mb-2 label-caps">Entry Logic</div>
              <Textarea className="min-h-16 resize-none rounded-sm border-border bg-background font-data text-sm" value={scenario.entry} onChange={(event) => setScenario({ ...scenario, entry: event.target.value })} />
            </div>
            <div>
              <div className="mb-2 label-caps">Exit Logic</div>
              <Textarea className="min-h-16 resize-none rounded-sm border-border bg-background font-data text-sm" value={scenario.exit} onChange={(event) => setScenario({ ...scenario, exit: event.target.value })} />
            </div>
          </ConfigGroup>
          <ConfigGroup title="Indicator Settings">
            <SliderRow label="EMA Period (Fast/Slow)" value={`${ema[0]} / 21`} sliderValue={ema} setSliderValue={setEma} min={5} max={20} step={1} />
            <SliderRow label="Sector Correlation (SPY)" value={(correlation[0] / 100).toFixed(2)} sliderValue={correlation} setSliderValue={setCorrelation} min={0} max={100} step={1} checked />
            <SliderRow label="Relative Volume (RVOL)" value={rvol[0].toFixed(1)} sliderValue={rvol} setSliderValue={setRvol} min={0.5} max={3} step={0.1} />
          </ConfigGroup>
          <ConfigGroup title="Risk Architecture">
            <SliderRow label="ATR Stop Multiplier" value={atr[0].toFixed(1)} sliderValue={atr} setSliderValue={setAtr} min={0.5} max={4} step={0.1} />
            <SliderRow label="Risk Per Trade ($)" value={String(risk[0])} sliderValue={risk} setSliderValue={setRisk} min={100} max={2000} step={50} />
            <div className="border border-border bg-card p-3">
              <div className="flex items-center justify-between label-caps"><span>Calculated Position Size</span><span className="text-primary">Auto-calc</span></div>
              <div className="mt-3 flex items-end justify-between"><span className="font-data text-3xl font-bold text-white">{positionSize}</span><span className="text-muted-foreground">SHARES</span></div>
            </div>
          </ConfigGroup>
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-border bg-card p-4">
        <Button onClick={runSimulation} className="h-10 w-full rounded-sm font-bold uppercase tracking-[0.12em]"><Zap data-icon="inline-start" />Run Simulation</Button>
      </div>
    </Panel>
  );
}

function LabCandleChart({ candles }: { candles: Candle[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      autoSize: true
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", downColor: "#fca5a5",
      borderUpColor: "#34d399", borderDownColor: "#fca5a5",
      wickUpColor: "#34d399", wickDownColor: "#fca5a5"
    });
    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "",
      color: "rgba(192,193,255,0.28)", lastValueVisible: false, priceLineVisible: false
    });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = cs;
    volRef.current = vs;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volRef.current || !candles.length) return;
    candleRef.current.setData(candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    volRef.current.setData(candles.map((c) => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? "rgba(52,211,153,0.24)" : "rgba(252,165,165,0.24)" })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={hostRef} className="h-full w-full" />;
}

function IntelligencePage({ watchlist }: { watchlist: WatchSymbol[] }) {
  const [feedVisible, setFeedVisible] = useState(true);
  const shownItems = feedVisible ? intelItems : [];

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_330px] overflow-hidden max-xl:grid-cols-1 max-xl:overflow-auto">
      <ScrollArea>
        <div className="p-5">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <div className="label-caps mb-2">Signal Feed</div>
              <h1 className="text-2xl font-bold text-white">Market Intelligence</h1>
              <p className="mt-1 font-data text-sm text-muted-foreground">Real-time macro & equities sentiment analysis engine.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm"><Filter data-icon="inline-start" />All Sectors</Button>
              <Button variant="outline" size="sm"><Filter data-icon="inline-start" />Impact: High</Button>
              <Button variant="ghost" size="sm" onClick={() => setFeedVisible((current) => !current)}>{feedVisible ? "Clear Feed" : "Restore Feed"}</Button>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-4 gap-3">
            <SignalStat label="High Impact" value="2" />
            <SignalStat label="Bullish Bias" value="0.68" />
            <SignalStat label="Macro Watch" value="FOMC" />
            <SignalStat label="Queue" value={`${shownItems.length}/12`} />
          </div>
          <div className="flex flex-col gap-3">
            {shownItems.map((item) => <IntelCard key={item.title} item={item} />)}
            {!shownItems.length ? (
              <Panel className="p-8 text-center">
                <div className="label-caps">Feed Cleared</div>
                <div className="mt-2 text-sm text-muted-foreground">No intelligence cards are visible. Restore the feed to continue scanning.</div>
              </Panel>
            ) : null}
          </div>
        </div>
      </ScrollArea>
      <MarketPulse />
    </div>
  );
}

function IntelCard({ item }: { item: (typeof intelItems)[number] }) {
  const bullish = item.tone === "bullish";
  return (
    <div className={cn("border border-border border-l-4 bg-card p-4", bullish ? "border-l-lime-400" : "border-l-red-200")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Badge variant="secondary" className="rounded-none">{item.type}</Badge><span className="font-data text-xs text-muted-foreground">{item.time}</span></div>
        <div className="flex items-center gap-3"><Badge variant="outline" className={cn("rounded-none", bullish ? "text-lime-300" : "text-red-200")}>{item.tone}</Badge><span className="label-caps">Analyze</span><span className="border border-border px-2 py-1 font-data text-xs">IMP: {item.impact}</span></div>
      </div>
      <h2 className="mt-4 text-lg font-bold text-white">{item.title}</h2>
      <p className="mt-2 max-w-5xl text-sm leading-6 text-muted-foreground">{item.body}</p>
      <div className="mt-4 flex gap-10 border-t border-border pt-3">
        <MetricInline label="Affected" value={item.affected} />
        <MetricInline label="Model Confidence" value={item.confidence} />
      </div>
      <div className="mt-3 border border-border bg-[#141414] p-2.5 font-data text-xs leading-5 text-zinc-300"><span className="mr-2 text-primary">AI Insight</span>{item.insight}</div>
    </div>
  );
}

function MarketPulse() {
  return (
    <aside className="border-l border-border bg-background p-4">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg text-white">Market Pulse</h2><span className="size-2 rounded-full bg-lime-400" /></div>
      <Panel className="mb-4"><PanelTitle title="Volume Spikes > 200%" /><Table><TableBody>{[["$PLTR", "42M", "+8.4%"], ["$CRWD", "18M", "-4.2%"], ["$SOFI", "31M", "+5.1%"], ["$META", "12M", "+0.4%"]].map((r) => <TableRow key={r[0]}><TableCell className="font-data text-primary">{r[0]}</TableCell><TableCell className="text-right font-data">{r[1]}</TableCell><TableCell className={cn("text-right font-data", r[2].startsWith("+") ? "text-lime-300" : "text-red-200")}>{r[2]}</TableCell></TableRow>)}</TableBody></Table></Panel>
      <Panel><PanelTitle title="Global Sentiment Agg" /><SentimentSlider /></Panel>
    </aside>
  );
}

function SentimentSlider() {
  const [val, setVal] = useState([68]);
  return (
    <div className="p-3">
      <div className="mb-2 flex justify-between label-caps"><span>Bear</span><span>Neutral</span><span>Bull</span></div>
      <Slider value={val} onValueChange={setVal} max={100} />
      <div className="mt-4 text-center font-data text-2xl font-bold text-white">{val[0] / 100}</div>
      <div className={cn("label-caps text-center", val[0] > 70 ? "text-lime-400" : val[0] < 30 ? "text-red-300" : "text-zinc-400")}>
        {val[0] > 70 ? "Extreme Bullish" : val[0] > 50 ? "Leaning Bullish" : val[0] < 30 ? "Extreme Bearish" : "Neutral / Choppy"}
      </div>
    </div>
  );
}

function SignalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-card px-3 py-2">
      <div className="label-caps">{label}</div>
      <div className="mt-1 font-data text-base font-bold text-white">{value}</div>
    </div>
  );
}

function AiPage({ 
  watchlist, 
  portfolio,
  threads, 
  activeThreadId, 
  onSwitchThread, 
  onUpdateThreads 
}: { 
  watchlist: WatchSymbol[]; 
  portfolio: Holding[];
  threads: ChatThread[]; 
  activeThreadId: string | null; 
  onSwitchThread: (id: string | null) => void; 
  onUpdateThreads: (threads: ChatThread[] | ((prev: ChatThread[]) => ChatThread[])) => void; 
}) {
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [attachmentTitle, setAttachmentTitle] = useState("");
  const [attachmentDraft, setAttachmentDraft] = useState("");
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [chatMode, setChatMode] = useState("Long-Term Investor");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-create thread if activeThreadId is a "new-" placeholder
  useEffect(() => {
    if (activeThreadId?.startsWith("new-")) {
      const s = activeThreadId.split("-")[1] as SymbolKey;
      createNewThread(s);
    }
  }, [activeThreadId]);
  
  const activeThread = threads.find(t => t.id === activeThreadId) || null;
  const symbol = activeThread?.symbol ?? "NVDA";
  const messages = activeThread?.messages ?? [];

  const { candles, quote, marketNews, error } = useMarketData(symbol, "D");
  const selected = selectedQuote(symbol, quote);

  const refreshMemories = () => {
    fetchMemories(symbol).then(setMemories).catch(() => setMemories([]));
  };

  useEffect(() => {
    refreshMemories();
  }, [symbol]);

  const savePinnedMemory = () => {
    const content = memoryDraft.trim();
    if (!content || isSavingContext) return;
    setIsSavingContext(true);
    createMemory({
      category: "investment_style",
      content,
      symbol: "GLOBAL",
      source: "user_pinned",
      pinned: true
    }).then(() => {
      setMemoryDraft("");
      refreshMemories();
    }).finally(() => setIsSavingContext(false));
  };

  const saveAttachment = () => {
    const content = attachmentDraft.trim();
    if (!content || isSavingContext) return;
    setIsSavingContext(true);
    createContextAttachment({
      title: attachmentTitle.trim() || `Context for ${symbol}`,
      content,
      symbol,
      scope: "symbol"
    }).then(() => {
      setAttachmentTitle("");
      setAttachmentDraft("");
      refreshMemories();
    }).finally(() => setIsSavingContext(false));
  };

  const createNewThread = (initialSymbol: SymbolKey = "NVDA") => {
    const newThread: ChatThread = {
      id: crypto.randomUUID(),
      title: `New Analysis: ${initialSymbol}`,
      symbol: initialSymbol,
      messages: [{
        id: "system",
        type: "system",
        text: `Operational context locked to $${initialSymbol}. Deep-RAG and Web-Search engines initialized.`
      }],
      lastActive: Date.now()
    };
    onUpdateThreads(prev => [newThread, ...prev]);
    onSwitchThread(newThread.id);
    return newThread;
  };

  const deleteThread = (id: string) => {
    onUpdateThreads(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeThreadId === id) {
        if (next.length > 0) onSwitchThread(next[0].id);
        else onSwitchThread(null);
      }
      return next;
    });
  };

  const runPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) return;
    
    const targetThread = activeThread ?? createNewThread(symbol);
    const targetThreadId = targetThread.id;
    const targetMessages = activeThread ? messages : targetThread.messages;

    const operatorMsg: ChatUiMessage = { id: crypto.randomUUID(), type: "operator", text: trimmed };
    const nextMessages = [...targetMessages, operatorMsg];
    
    onUpdateThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, messages: nextMessages, lastActive: Date.now() } : t));
    setPrompt("");
    setIsSending(true);

    chatAboutMarket({
      symbol,
      quote: selected,
      candles,
      news: marketNews,
      portfolio,
      chatMode,
      prompt: trimmed,
      messages: nextMessages.map((msg) => ({ role: msg.type === "operator" ? "user" : "assistant", content: msg.text }))
    }).then((result) => {
      const analysisMsg: ChatUiMessage = { 
        id: crypto.randomUUID(), 
        type: "analysis", 
        text: result.content,
        activity: result.activity,
        sources: result.sources,
        memorySaved: result.memorySaved
      };
      onUpdateThreads(prev => prev.map(t => t.id === targetThreadId ? { 
        ...t, 
        messages: [...t.messages, analysisMsg],
        title: t.messages.length < 3 ? trimmed.slice(0, 30) + (trimmed.length > 30 ? "..." : "") : t.title
      } : t));
      if (result.memorySaved?.length) refreshMemories();
    }).catch((err) => {
      onUpdateThreads(prev => prev.map(t => t.id === targetThreadId ? { 
        ...t, 
        messages: [...t.messages, { id: crypto.randomUUID(), type: "analysis", text: err instanceof Error ? err.message : "AI request failed." }] 
      } : t));
    }).finally(() => {
      setIsSending(false);
    });
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden max-xl:flex-col max-xl:overflow-auto">
      <ThreadSidebar 
        threads={threads} 
        activeId={activeThreadId} 
        onSwitch={onSwitchThread} 
        onNew={createNewThread} 
        onDelete={deleteThread} 
      />
      <div className="flex min-w-0 flex-1 flex-col border-r border-border">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-5 py-2 label-caps max-md:flex-wrap max-md:px-3">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            <span className="truncate">Active Cluster: {symbol} | Deep-RAG Engine Active</span>
          </div>
          <div className="flex items-center gap-4 max-sm:hidden">
            <Badge variant="outline" className="border-primary/30 font-data text-primary uppercase">{selected.venue}</Badge>
            <span className="font-data text-white">{currency(selected.last)}</span>
          </div>
        </div>
        
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 max-md:p-4">
            <ChatModeBar mode={chatMode} onModeChange={setChatMode} />
            {!activeThread ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-primary/20 bg-primary/5">
                  <Bot className="size-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-white uppercase tracking-widest">Awaiting Analysis Thread</h2>
                <p className="mt-2 text-sm text-muted-foreground">Select a thread from the sidebar or start a new quantitative session.</p>
                <Button onClick={() => createNewThread()} className="mt-8 rounded-none px-10 uppercase tracking-tighter">Initialize Engine</Button>
              </div>
            ) : messages.map((message) => {
              if (message.type === "system") {
                return <MessageBlock key={message.id} icon={Cpu} kicker="SYS_BOOT_SEQUENCE">{renderTickerText(message.text)}</MessageBlock>;
              }
              if (message.type === "operator") {
                return (
                  <div key={message.id} className="flex flex-col items-end gap-2">
                    <div className="max-w-[85%] rounded-sm border border-border bg-card/40 p-4 text-sm leading-6 text-zinc-100 shadow-sm">
                      {message.text}
                    </div>
                    <span className="label-caps text-[10px]">Operator Request</span>
                  </div>
                );
              }
              return (
                <MessageBlock key={message.id} icon={ChartNoAxesCombined} kicker={`ANALYSIS_GEN_${message.sources?.toUpperCase() ?? "LOCAL"}`}>
                  <div className="space-y-4 rounded-sm border border-primary/10 bg-card/60 p-5 shadow-inner">
                    {message.activity && (
                      <div className="mb-4 space-y-1 border-b border-border/50 pb-4">
                        {message.activity.map((act, i) => (
                          <div key={i} className="font-data text-[10px] text-primary/70 animate-pulse">{act}</div>
                        ))}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{renderTickerText(message.text)}</p>
                    
                    {message.sources === "web" && (
                      <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
                        <Badge variant="outline" className="rounded-none border-emerald-500/20 bg-emerald-500/5 text-[10px] text-emerald-400">WEB SEARCH ACTIVE</Badge>
                        <span className="label-caps text-[10px]">Grounding in Live Data</span>
                      </div>
                    )}
                    {message.memorySaved && message.memorySaved.length > 0 && (
                      <div className="mt-3 flex items-center gap-2">
                        <Badge variant="outline" className="rounded-none border-primary/30 text-[10px] text-primary">MEMORY UPDATED</Badge>
                        <span className="label-caps text-[10px]">{message.memorySaved.length} durable item saved</span>
                      </div>
                    )}
                  </div>
                </MessageBlock>
              );
            })}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border bg-[#030303] p-4">
          <div className="mx-auto flex max-w-4xl items-center gap-3 border border-primary/20 bg-background/50 p-2 shadow-2xl focus-within:border-primary/50">
            <span className="pl-2 font-data font-bold text-primary">$</span>
            <Input
              className="h-10 min-w-0 flex-1 border-0 bg-transparent font-data text-sm focus-visible:ring-0"
              placeholder={isSending ? "Synthesizing market data..." : "Enter research vector / CMD..."}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runPrompt()}
              disabled={isSending}
            />
            <Button 
              id="execute-btn"
              onClick={runPrompt} 
              disabled={isSending || !prompt.trim()} 
              className="h-10 rounded-none px-6 font-bold uppercase tracking-widest transition-all"
            >
              {isSending ? <span className="flex items-center gap-2"><Zap className="size-3 animate-spin" />Sync</span> : "Execute"}
            </Button>
          </div>
        </div>
      </div>
      <MemoryPanel
        memories={memories}
        memoryDraft={memoryDraft}
        attachmentTitle={attachmentTitle}
        attachmentDraft={attachmentDraft}
        isSaving={isSavingContext}
        onMemoryDraftChange={setMemoryDraft}
        onAttachmentTitleChange={setAttachmentTitle}
        onAttachmentDraftChange={setAttachmentDraft}
        onSaveMemory={savePinnedMemory}
        onSaveAttachment={saveAttachment}
        onTogglePinned={(memory) => updateMemory(memory.id, { pinned: !memory.pinned }).then(refreshMemories)}
        onDisable={(memory) => updateMemory(memory.id, { enabled: false }).then(refreshMemories)}
        onDelete={(memory) => deleteMemory(memory.id).then(refreshMemories)}
      />
      <DeepDivePanel symbol={symbol} selected={selected} candles={candles} onSymbolChange={(s) => {
        // Find existing thread or switch symbol of active thread
        const existing = threads.find(t => t.symbol === s);
        if (existing) {
          onSwitchThread(existing.id);
        } else if (activeThread) {
          onUpdateThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, symbol: s, title: `Research: ${s}` } : t));
        } else {
          createNewThread(s);
        }
      }} dataError={error} />
    </div>
  );
}

function ThreadSidebar({ 
  threads, 
  activeId, 
  onSwitch, 
  onNew, 
  onDelete 
}: { 
  threads: ChatThread[]; 
  activeId: string | null; 
  onSwitch: (id: string) => void; 
  onNew: (symbol: SymbolKey) => void; 
  onDelete: (id: string) => void; 
}) {
  return (
    <aside className="flex w-[260px] flex-col border-r border-border bg-[#020202] max-xl:w-full max-xl:h-[180px] max-xl:border-b max-xl:border-r-0">
      <div className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="label-caps font-bold text-white">Analysis Clusters</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => onNew("NVDA")} className="hover:bg-primary/10 hover:text-primary">
          <Plus className="size-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2 max-xl:flex-row max-xl:overflow-x-auto">
          {threads.length === 0 ? (
            <div className="py-10 text-center px-4">
              <History className="mx-auto size-6 text-muted-foreground opacity-20" />
              <p className="mt-2 text-[10px] uppercase tracking-tighter text-muted-foreground">No sessions active</p>
            </div>
          ) : threads.map((thread) => (
            <div 
              key={thread.id}
              className={cn(
                "group relative flex items-center justify-between rounded-sm px-3 py-2.5 transition-all cursor-pointer max-xl:min-w-[180px]",
                activeId === thread.id ? "bg-primary/10 text-white shadow-[inset_4px_0_0_0_hsl(var(--primary))]" : "text-muted-foreground hover:bg-white/5 hover:text-zinc-200"
              )}
              onClick={() => onSwitch(thread.id)}
            >
              <div className="flex min-w-0 items-center gap-3">
                <MessageSquare className={cn("size-3.5 shrink-0", activeId === thread.id ? "text-primary" : "text-zinc-600")} />
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-xs font-bold uppercase tracking-tight">{thread.title}</span>
                  <span className="text-[9px] opacity-40 font-data">{new Date(thread.lastActive).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon-xs" 
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                onClick={(e) => { e.stopPropagation(); onDelete(thread.id); }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

function MemoryPanel({
  memories,
  memoryDraft,
  attachmentTitle,
  attachmentDraft,
  isSaving,
  onMemoryDraftChange,
  onAttachmentTitleChange,
  onAttachmentDraftChange,
  onSaveMemory,
  onSaveAttachment,
  onTogglePinned,
  onDisable,
  onDelete
}: {
  memories: MemoryItem[];
  memoryDraft: string;
  attachmentTitle: string;
  attachmentDraft: string;
  isSaving: boolean;
  onMemoryDraftChange: (value: string) => void;
  onAttachmentTitleChange: (value: string) => void;
  onAttachmentDraftChange: (value: string) => void;
  onSaveMemory: () => void;
  onSaveAttachment: () => void;
  onTogglePinned: (memory: MemoryItem) => void;
  onDisable: (memory: MemoryItem) => void;
  onDelete: (memory: MemoryItem) => void;
}) {
  const visibleMemories = memories.filter((memory) => memory.enabled !== false).slice(0, 10);
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-[#020202] max-2xl:hidden">
      <div className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="label-caps font-bold text-white">Partner Memory</h2>
          <p className="mt-1 text-[10px] uppercase tracking-tight text-muted-foreground">Investment context persists</p>
        </div>
        <Brain className="size-4 text-primary" />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <div className="rounded-sm border border-primary/15 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-2 label-caps text-primary">
              <Pin className="size-3" />
              Pin Core Preference
            </div>
            <Textarea
              className="min-h-20 rounded-sm border-border bg-background/80 text-xs"
              placeholder="Example: I care more about long-term investing, portfolio thesis, and conviction than short-term trades."
              value={memoryDraft}
              onChange={(event) => onMemoryDraftChange(event.target.value)}
            />
            <Button className="mt-2 h-8 w-full rounded-none text-[10px] uppercase tracking-widest" onClick={onSaveMemory} disabled={isSaving || !memoryDraft.trim()}>
              Save Memory
            </Button>
          </div>

          <div className="rounded-sm border border-border bg-card/40 p-3">
            <div className="mb-2 flex items-center gap-2 label-caps">
              <Paperclip className="size-3" />
              Attach Context
            </div>
            <Input
              className="mb-2 h-8 rounded-sm border-border bg-background/80 text-xs"
              placeholder="Thesis title"
              value={attachmentTitle}
              onChange={(event) => onAttachmentTitleChange(event.target.value)}
            />
            <Textarea
              className="min-h-24 rounded-sm border-border bg-background/80 text-xs"
              placeholder="Paste research, thesis notes, earnings notes, or portfolio context for this symbol."
              value={attachmentDraft}
              onChange={(event) => onAttachmentDraftChange(event.target.value)}
            />
            <Button variant="outline" className="mt-2 h-8 w-full rounded-none text-[10px] uppercase tracking-widest" onClick={onSaveAttachment} disabled={isSaving || !attachmentDraft.trim()}>
              Attach To Cluster
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="label-caps">Active Recall</div>
            {visibleMemories.length === 0 ? (
              <div className="rounded-sm border border-border p-3 text-xs text-muted-foreground">No memory loaded yet.</div>
            ) : visibleMemories.map((memory) => (
              <div key={memory.id} className="rounded-sm border border-border bg-background/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge variant="outline" className="rounded-none text-[9px] uppercase">{memory.category.replace(/_/g, " ")}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={() => onTogglePinned(memory)} title={memory.pinned ? "Unpin memory" : "Pin memory"}>
                      <Pin className={cn("size-3", memory.pinned && "text-primary")} />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => onDisable(memory)} title="Disable memory">
                      <X className="size-3" />
                    </Button>
                    {memory.source !== "system_seed" && (
                      <Button variant="ghost" size="icon-xs" onClick={() => onDelete(memory)} title="Delete memory">
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="line-clamp-4 text-xs leading-5 text-zinc-300">{memory.content}</p>
                <div className="mt-2 font-data text-[9px] uppercase text-muted-foreground">{memory.symbol} / {memory.source.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

function ChatModeBar({ mode, onModeChange }: { mode: string; onModeChange: (mode: string) => void }) {
  const modes = ["Long-Term Investor", "Portfolio Brain", "Thesis Review", "Earnings Review", "Risk Check", "News Impact", "Buy More / Hold / Trim", "Trade Setup"];
  return (
    <div className="rounded-sm border border-border bg-card/30 p-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="label-caps">Research Mode</div>
        <Badge variant="outline" className="rounded-none text-[10px]">{mode}</Badge>
      </div>
      <ToggleGroup type="single" value={mode} onValueChange={(value) => value && onModeChange(value)} className="flex flex-wrap justify-start gap-2">
        {modes.map((item) => (
          <ToggleGroupItem key={item} value={item} className="h-7 rounded-sm px-2 font-data text-[10px] uppercase tracking-tight">
            {item}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function renderTickerText(text: string) {
  return text.split(/(\$[A-Z0-9.]+)/g).map((part, index) => part.startsWith("$") ? <span key={`${part}-${index}`} className="text-primary">{part}</span> : part);
}

function DeepDivePanel({ symbol, selected, candles, onSymbolChange, dataError }: { symbol: SymbolKey; selected: WatchSymbol; candles: Candle[]; onSymbolChange: (symbol: SymbolKey) => void; dataError: string | null }) {
  const last = candles.at(-1)?.close ?? selected.last;
  const first = candles[0]?.close ?? last;
  const trend = first ? ((last - first) / first) * 100 : selected.changePercent;
  const recent = candles.slice(-14);
  const high = Math.max(...recent.map((item) => item.high), last);
  const low = Math.min(...recent.map((item) => item.low), last);
  const avgVolume = recent.length ? recent.reduce((sum, item) => sum + item.volume, 0) / recent.length : 0;
  return (
    <aside className="overflow-auto border-l border-blue-950 bg-background p-4 max-xl:border-l-0 max-xl:border-t">
      <div className="mb-5 flex items-start justify-between"><div><h2 className="font-data text-sm font-bold uppercase tracking-[0.25em] text-primary">Deep Dive: ${symbol}</h2><p className="label-caps mt-1">{dataError ? "Fallback Data" : "Massive Context"}</p></div><div className="flex gap-3"><Activity className="size-4" /><Expand className="size-4" /></div></div>
      <Select value={symbol} onValueChange={(value) => onSymbolChange(value as SymbolKey)}>
        <SelectTrigger className="mb-4 h-10 w-full rounded-sm border-border bg-background font-data">
          <SelectValue placeholder="Select stock" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {watchlist.map((item) => <SelectItem key={item.symbol} value={item.symbol}>{item.symbol} - {item.name}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="mb-4 flex items-end justify-between"><div className="font-data text-3xl font-black text-white">{currency(last)}</div><div className={cn("text-right font-data text-sm font-bold", selected.changePercent >= 0 ? "text-lime-400" : "text-red-200")}>{signed(selected.changePercent, "%")}<div className="label-caps text-muted-foreground">Latest</div></div></div>
      <div className="mb-5 h-24 border border-blue-950"><StockChart candles={candles.slice(-40)} /></div>
      <div className="mb-5"><div className="mb-3 flex justify-between label-caps"><span>Trend Score</span><span className="text-primary">{Math.min(100, Math.max(0, Math.round(50 + trend))).toFixed(0)}%</span></div><Slider value={[Math.min(100, Math.max(0, 50 + trend))]} max={100} disabled /></div>
      <div className="grid grid-cols-2 border border-blue-950">
        {[["14D High", number(high), "RES"], ["14D Low", number(low), "SUP"], ["Range", signed(trend, "%"), trend >= 0 ? "BULL" : "BEAR"], ["VOL/AVG", avgVolume ? `${Math.round(avgVolume / 1000000)}M` : "N/A", "FLOW"]].map((m) => <div key={m[0]} className="border-b border-r border-blue-950 p-3"><div className="label-caps">{m[0]}</div><div className="mt-2 font-data text-xl text-white">{m[1]}</div><Badge variant="outline" className="mt-2 rounded-none">{m[2]}</Badge></div>)}
      </div>
      <div className="mt-5"><PanelTitle title="Asset Correlation" />{[[`${symbol} / QQQ`, "0.82", 82], [`${symbol} / SPY`, "0.71", 71]].map(([label, value, width]) => <div key={label as string} className="mt-3 grid grid-cols-[1fr_120px_36px] items-center gap-3 font-data text-sm"><span>{label}</span><div className="h-1.5 bg-muted"><div className="h-full bg-primary" style={{ width: `${width}%` }} /></div><span className="text-primary">{value}</span></div>)}</div>
    </aside>
  );
}

function JournalPage({
  rows,
  onAddTrade,
  onUpdateTrade,
  watchlist
}: {
  rows: AuditRow[];
  onAddTrade: (row: AuditRow) => void;
  onUpdateTrade: (index: number, row: AuditRow) => void;
  watchlist: WatchSymbol[];
}) {
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    timestamp: "2024.05.13 09:30:00",
    ticker: "NVDA",
    side: "BUY",
    price: "894.52",
    duration: "15m 00s",
    rr: "2.0",
    tag: "#MANUAL",
    pnl: "+250.00",
    notes: "manual_trade_entry; setup_confirmed"
  });
  const totalPnl = rows.reduce((sum, row) => sum + Number(row[7].replace(/[$,+]/g, "")), 0);
  const winRate = rows.length ? Math.round((rows.filter((row) => row[7].startsWith("+")).length / rows.length) * 1000) / 10 : 0;
  const resetDraft = () => {
    setDraft({
      timestamp: "2024.05.13 09:30:00",
      ticker: "NVDA",
      side: "BUY",
      price: "894.52",
      duration: "15m 00s",
      rr: "2.0",
      tag: "#MANUAL",
      pnl: "+250.00",
      notes: "manual_trade_entry; setup_confirmed"
    });
    setEditingIndex(null);
  };
  const saveTrade = () => {
    const signedPnl = draft.pnl.trim().startsWith("-") ? `-$${draft.pnl.replace(/[-$,+]/g, "")}` : `+$${draft.pnl.replace(/[-$,+]/g, "")}`;
    const nextRow: AuditRow = [
      draft.timestamp.trim() || "2024.05.13 09:30:00",
      draft.ticker.trim().toUpperCase() || "NVDA",
      draft.side,
      draft.price.trim() || "0.00",
      draft.duration.trim() || "00m 00s",
      draft.rr.trim() || "0.0",
      draft.tag.trim().startsWith("#") ? draft.tag.trim().toUpperCase() : `#${draft.tag.trim().toUpperCase() || "MANUAL"}`,
      signedPnl,
      draft.notes.trim() || "manual_trade_entry"
    ];
    if (editingIndex === null) {
      onAddTrade(nextRow);
    } else {
      onUpdateTrade(editingIndex, nextRow);
    }
    setShowTradeForm(false);
    resetDraft();
  };
  const editTrade = (row: AuditRow, index: number) => {
    setDraft({
      timestamp: row[0],
      ticker: row[1],
      side: row[2],
      price: row[3],
      duration: row[4],
      rr: row[5],
      tag: row[6],
      pnl: row[7].replace("$", ""),
      notes: row[8]
    });
    setEditingIndex(index);
    setShowTradeForm(true);
  };

  return (
    <div className="min-h-full overflow-auto p-5 max-md:p-3">
      <div className="mb-4 grid grid-cols-[1fr_1fr_1fr_220px] gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <JournalMetric title="Win Rate" value={`${winRate}%`} green />
        <JournalMetric title="Profit Factor" value="1.84" bars />
        <JournalMetric title="Total P&L" value={currency(totalPnl)} green meta="+12.4%" />
        <Button onClick={() => { resetDraft(); setShowTradeForm((current) => !current); }} className="min-h-14 rounded-sm bg-primary text-sm font-black text-black hover:bg-primary/90">
          <Plus data-icon="inline-start" />
          Add Trade
        </Button>
      </div>
      {showTradeForm ? (
        <Panel className="mb-5">
          <PanelTitle title={editingIndex === null ? "add_trade_entry.form" : "edit_trade_entry.form"} action={<Button variant="ghost" size="sm" onClick={() => { setShowTradeForm(false); resetDraft(); }}>Cancel</Button>} />
          <div className="grid grid-cols-6 gap-4 p-4 max-lg:grid-cols-3 max-sm:grid-cols-1">
            <TradeField label="Timestamp" value={draft.timestamp} onChange={(value) => setDraft({ ...draft, timestamp: value })} className="col-span-2 max-sm:col-span-1" />
            <div>
              <div className="mb-2 label-caps">Ticker</div>
              <Select value={draft.ticker} onValueChange={(value) => {
                const selected = watchlist.find((item) => item.symbol === value);
                setDraft({ ...draft, ticker: value, price: selected ? number(selected.last) : draft.price });
              }}>
                <SelectTrigger className="h-10 w-full rounded-sm border-border bg-background font-data">
                  <SelectValue placeholder="Select stock" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {watchlist.map((item) => (
                      <SelectItem key={item.symbol} value={item.symbol}>
                        {item.symbol} - {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 label-caps">Side</div>
              <ToggleGroup type="single" value={draft.side} onValueChange={(value) => value && setDraft({ ...draft, side: value })} className="grid h-10 grid-cols-2 rounded-sm border border-border bg-background">
                <ToggleGroupItem value="BUY" className="rounded-none font-data text-xs data-[state=on]:text-emerald-300">BUY</ToggleGroupItem>
                <ToggleGroupItem value="SELL" className="rounded-none font-data text-xs data-[state=on]:text-red-200">SELL</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <TradeField label="Price" value={draft.price} onChange={(value) => setDraft({ ...draft, price: value })} />
            <TradeField label="Duration" value={draft.duration} onChange={(value) => setDraft({ ...draft, duration: value })} />
            <TradeField label="R:R" value={draft.rr} onChange={(value) => setDraft({ ...draft, rr: value })} />
            <TradeField label="Tag" value={draft.tag} onChange={(value) => setDraft({ ...draft, tag: value })} />
            <TradeField label="P&L" value={draft.pnl} onChange={(value) => setDraft({ ...draft, pnl: value })} />
            <div className="col-span-3 max-sm:col-span-1">
              <div className="mb-2 label-caps">Audit Notes</div>
              <Textarea className="min-h-10 resize-none rounded-sm border-border bg-background font-data" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </div>
            <div className="col-span-6 flex justify-end border-t border-border pt-4 max-lg:col-span-3 max-sm:col-span-1">
              <Button onClick={saveTrade} className="rounded-sm px-8 font-bold uppercase tracking-[0.12em]"><CheckCircle2 data-icon="inline-start" />{editingIndex === null ? "Save Trade" : "Update Trade"}</Button>
            </div>
          </div>
        </Panel>
      ) : null}
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_320px] gap-3 max-xl:grid-cols-1">
        <Panel className="h-44 p-3"><PanelTitle title="Equity Curve (Cumulative P&L)" /><MarketSvg compact /></Panel>
        <Panel className="h-44 p-3"><PanelTitle title="P/L Distribution" /><div className="flex h-24 items-center justify-center"><div className="h-6 w-16 bg-muted" /></div></Panel>
      </div>
      <Panel className="min-h-0">
        <PanelTitle title="executed_trades_audit_log.json" action={<span className="label-caps"><Download className="mr-1 inline size-3" />Export_Data</span>} />
        <AuditTable rows={rows} onEdit={editTrade} />
      </Panel>
    </div>
  );
}



function PortfolioPage({ rows, onAddHolding, onUpdateHolding, watchlist }: { rows: Holding[]; onAddHolding: (holding: Omit<Holding, "id">) => void; onUpdateHolding: (id: string, patch: Partial<Holding>) => void; watchlist: WatchSymbol[] }) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Omit<Holding, "id">>({
    symbol: "NVDA",
    shares: 100,
    averageCost: 850.42,
    conviction: "core",
    timeHorizon: "long-term",
    thesis: "",
    invalidation: "",
    riskNotes: ""
  });

  const holdings = useMemo(() => rows.map((holding) => {
    const quote = watchlist.find((item) => item.symbol === holding.symbol) ?? watchlist[0];
    const value = holding.shares * quote.last;
    const pnl = value - holding.shares * holding.averageCost;
    const pnlPercent = holding.averageCost ? ((quote.last - holding.averageCost) / holding.averageCost) * 100 : 0;
    return { ...holding, last: quote.last, value, pnl, pnlPercent };
  }), [rows, watchlist]);

  const total = holdings.reduce((sum, row) => sum + row.value, 0);
  const invested = holdings.reduce((sum, row) => sum + row.shares * row.averageCost, 0);
  const pnl = holdings.reduce((sum, row) => sum + row.pnl, 0);
  const cashBuffer = Math.max(total * 0.18, 2500);
  const totalBalance = total + cashBuffer;
  const portfolioReturn = invested ? (pnl / invested) * 100 : 0;
  const thesisCoverage = holdings.length ? Math.round((holdings.filter((row) => row.thesis?.trim()).length / holdings.length) * 100) : 0;
  const chartSeries = useMemo(() => buildPortfolioSeries(total || invested || 1), [invested, total]);

  const saveHolding = () => {
    onAddHolding(draft);
    setShowForm(false);
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6 overflow-auto bg-background">
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Initialize New Holding</DialogTitle>
            <DialogDescription className="label-caps opacity-60">Add an asset to your core portfolio ledger</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
             <div className="flex flex-col gap-2">
                <span className="label-caps opacity-60">Ticker Symbol</span>
                <Select value={draft.symbol} onValueChange={(val) => setDraft({ ...draft, symbol: val as SymbolKey })}>
                   <SelectTrigger className="font-data"><SelectValue /></SelectTrigger>
                   <SelectContent>{watchlist.map(i => <SelectItem key={i.symbol} value={i.symbol}>{i.symbol}</SelectItem>)}</SelectContent>
                </Select>
             </div>
             <div className="flex flex-col gap-2">
                <span className="label-caps opacity-60">Shares / Quantity</span>
                <Input type="number" className="font-data" value={draft.shares} onChange={e => setDraft({...draft, shares: Number(e.target.value)})} />
             </div>
             <div className="flex flex-col gap-2">
                <span className="label-caps opacity-60">Average Entry Price</span>
                <Input type="number" className="font-data" value={draft.averageCost} onChange={e => setDraft({...draft, averageCost: Number(e.target.value)})} />
             </div>
             <div className="flex flex-col gap-2">
                <span className="label-caps opacity-60">Conviction Tier</span>
                <Select value={draft.conviction} onValueChange={(val) => setDraft({ ...draft, conviction: val as any })}>
                   <SelectTrigger className="font-data"><SelectValue /></SelectTrigger>
                   <SelectContent>
                      {["watch", "starter", "core", "high"].map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                   </SelectContent>
                </Select>
             </div>
             <div className="col-span-2 flex flex-col gap-2">
                <span className="label-caps opacity-60">Investment Thesis</span>
                <Textarea className="min-h-20 font-data text-xs" value={draft.thesis} onChange={e => setDraft({...draft, thesis: e.target.value})} placeholder="Why are you taking this position?" />
             </div>
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
             <Button onClick={saveHolding} className="px-8 font-bold uppercase tracking-wider">Commit to Ledger</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overview Intelligence */}
      <div className="grid grid-cols-1 xl:grid-cols-[440px_minmax(0,1fr)] gap-6">
        <PortfolioOverviewCard totalBalance={totalBalance} invested={invested} available={cashBuffer} pnl={pnl} returnPercent={portfolioReturn} thesisCoverage={thesisCoverage} />
        <MarketStrip watchlist={watchlist} />
      </div>

      {/* Main Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6">
        <div className="flex flex-col gap-6 min-h-0">
          <Card className="flex-1 flex flex-col min-h-[480px]">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-xl font-bold">Equity Intelligence</CardTitle>
                <CardDescription className="font-data text-xs uppercase tracking-wider">Total Value: {currency(totalBalance)}</CardDescription>
              </div>
              <Tabs defaultValue="year" className="w-[320px]">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="day">Day</TabsTrigger>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="year">Year</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="flex-1 p-6 flex flex-col">
              <PortfolioPerformanceChart total={total} pnl={pnl} series={chartSeries} />
            </CardContent>
          </Card>

          <Card className="min-h-0">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle>Active Ledger</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowForm(true)}><Plus data-icon="inline-start" />Add Position</Button>
                <Button variant="outline" size="sm"><Download data-icon="inline-start" />Export</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <PortfolioAssetList holdings={holdings} watchlist={watchlist} onUpdateHolding={onUpdateHolding} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Portfolio Brain</CardTitle>
              <CardDescription>Durable investment thesis context</CardDescription>
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-4">
              {holdings.map((row) => (
                <ThesisCard key={row.id} holding={row} onUpdate={(patch) => onUpdateHolding(row.id, patch)} />
              ))}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Allocation Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-4">
               {holdings.map((row) => {
                const pct = total ? Math.round((row.value / total) * 100) : 0;
                return <AllocationRow key={row.id} symbol={row.symbol} pct={pct} value={row.value} />;
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PortfolioOverviewCard({ totalBalance, invested, available, pnl, returnPercent, thesisCoverage }: { totalBalance: number; invested: number; available: number; pnl: number; returnPercent: number; thesisCoverage: number }) {
  const placedPct = totalBalance ? Math.round((invested / totalBalance) * 100) : 0;
  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <Badge variant={returnPercent >= 0 ? "secondary" : "destructive"}>{signed(returnPercent, "%")}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          <div className="label-caps opacity-60">Total Balance</div>
          <div className="font-data text-3xl font-black text-white">{currency(totalBalance)}</div>
          <div className="relative mt-2 flex size-32 items-center justify-center self-center">
            <svg className="size-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-muted/20" />
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={`${placedPct * 2.51} 251`} className="text-primary transition-all duration-1000 ease-in-out" strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-data text-xl font-bold">{placedPct}%</span>
              <span className="label-caps text-[8px] opacity-60">Placed</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="flex flex-col gap-1 border-r pr-2">
              <span className="label-caps text-[9px] opacity-60">Placed</span>
              <span className="font-data text-xs font-bold">{currency(invested)}</span>
            </div>
            <div className="flex flex-col gap-1 pl-2">
              <span className="label-caps text-[9px] opacity-60">Available</span>
              <span className="font-data text-xs font-bold">{currency(available)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="label-caps opacity-60">Past Month</div>
          <div className="font-data text-3xl font-black text-white">{currency(Math.abs(pnl))}</div>
          <div className="relative mt-2 flex size-32 items-center justify-center self-center">
            <svg className="size-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-muted/20" />
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={`${thesisCoverage * 2.51} 251`} className="text-emerald-500 transition-all duration-1000 ease-in-out" strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-data text-xl font-bold">{thesisCoverage}%</span>
              <span className="label-caps text-[8px] opacity-60">Thesis</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="flex flex-col gap-1 border-r pr-2">
              <span className="label-caps text-[9px] opacity-60">Overall</span>
              <span className="font-data text-xs font-bold text-emerald-400">{signed(returnPercent, "%")}</span>
            </div>
            <div className="flex flex-col gap-1 pl-2">
              <span className="label-caps text-[9px] opacity-60">Portfolio</span>
              <span className="font-data text-xs font-bold">{thesisCoverage}%</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MarketStrip({ watchlist }: { watchlist: WatchSymbol[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b py-4">
        <CardTitle className="text-lg">Current Market</CardTitle>
        <Badge variant="outline" className="rounded-none text-[9px] tracking-widest uppercase">Live Pulse</Badge>
      </CardHeader>
      <ScrollArea className="w-full">
        <div className="flex p-4 gap-4">
          {watchlist.slice(0, 8).map((item) => (
            <Card key={item.symbol} className="min-w-[200px] bg-background/50 border-border/50 transition-all hover:border-primary/40">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-data text-sm font-bold text-white uppercase">{item.symbol}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{item.name}</span>
                  </div>
                  <Badge variant={item.changePercent >= 0 ? "secondary" : "destructive"} className="rounded-none text-[9px] font-data">
                    {signed(item.changePercent, "%")}
                  </Badge>
                </div>
                <div className="h-10 flex items-end">
                   <MiniLine positive={item.changePercent >= 0} seed={item.symbol.length + Math.round(Math.abs(item.changePercent) * 10)} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 flex-1 text-[10px] uppercase font-bold tracking-tight">Short</Button>
                  <Button variant="secondary" size="sm" className="h-7 flex-1 text-[10px] uppercase font-bold tracking-tight">Buy</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </Card>
  );
}

function PortfolioPerformanceChart({ total, pnl, series }: { total: number; pnl: number; series: Array<{ label: string; value: number }> }) {
  const width = 640;
  const height = 240;
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = series.map((point, index) => {
    const x = (index / Math.max(1, series.length - 1)) * width;
    const y = height - ((point.value - min) / range) * (height - 40) - 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <div className="flex-1 flex flex-col gap-6">
       <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="label-caps opacity-60">Total Investments</span>
            <div className="font-data text-2xl font-black text-white">{currency(total)}</div>
          </div>
          <div className="flex items-center gap-4 text-right">
             <div className="flex flex-col gap-1">
               <span className="label-caps opacity-60 text-right">Unrealized P&L</span>
               <div className={cn("font-data text-xl font-bold", pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                 {signed(pnl / (total - pnl) * 100, "%")}
               </div>
             </div>
          </div>
       </div>
       <div className="flex-1 min-h-0 relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((tick) => (
              <line key={tick} x1="0" x2={width} y1={height * tick} y2={height * tick} className="stroke-border/40" strokeDasharray="4 4" />
            ))}
            <polygon points={area} fill="url(#chartGradient)" />
            <polyline points={points} fill="none" className="stroke-primary" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
       </div>
    </div>
  );
}

function PortfolioAssetList({ holdings, watchlist, onUpdateHolding }: { holdings: Array<Holding & { last: number; value: number; pnl: number; pnlPercent: number }>; watchlist: WatchSymbol[]; onUpdateHolding: (id: string, patch: Partial<Holding>) => void }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between p-4 border-b">
         <div className="flex items-center gap-2">
            <Select defaultValue="stocks">
              <SelectTrigger className="h-8 w-32 rounded-none bg-background/50 font-data text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="stocks">Stocks</SelectItem><SelectItem value="all">Total Alpha</SelectItem></SelectContent>
            </Select>
         </div>
         <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs"><Search className="size-3" /></Button>
            <Button variant="ghost" size="icon-xs"><Filter className="size-3" /></Button>
         </div>
      </div>
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[60px] pl-4">Asset</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right pr-4">PnL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((row) => (
              <TableRow key={row.id} className="group border-b/40">
                <TableCell className="pl-4">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted/40 font-data text-[10px] font-black group-hover:bg-primary/20 transition-colors">
                    {row.symbol.slice(0, 2)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-data font-bold text-white">{row.symbol}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{row.conviction}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-data text-xs">{number(row.shares)}</TableCell>
                <TableCell className="text-right font-data text-xs">{currency(row.last)}</TableCell>
                <TableCell className="text-right font-data text-sm font-bold text-white">{currency(row.value)}</TableCell>
                <TableCell className="text-right pr-4">
                   <div className="flex flex-col items-end">
                      <span className={cn("font-data text-xs font-bold", row.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {signed(row.pnlPercent, "%")}
                      </span>
                      <Button variant="ghost" className="h-4 p-0 text-[9px] uppercase opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onUpdateHolding(row.id, { shares: 0 })}>Exit</Button>
                   </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function AllocationRow({ symbol, pct, value }: { symbol: SymbolKey; pct: number; value: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center font-data text-[11px]">
        <span className="text-white font-bold">{symbol}</span>
        <span className="text-muted-foreground">{pct}% • {currency(value)}</span>
      </div>
      <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ReviewQueue({ holdings }: { holdings: Array<Holding & { last: number; value: number; pnl: number; pnlPercent: number }> }) {
  const needsReview = holdings.filter((row) => !row.thesis || !row.invalidation);
  if (!needsReview.length) return null;

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-xs uppercase tracking-tighter text-primary">Critical Review Queue</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-col gap-2">
        {needsReview.slice(0, 3).map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 p-2 bg-background/40 border border-border/40">
             <span className="font-data text-[11px] font-bold">{row.symbol}</span>
             <Badge variant="outline" className="text-[9px] border-primary/20 text-primary uppercase">No Thesis</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MiniLine({ positive, seed }: { positive: boolean; seed: number }) {
  const points = Array.from({ length: 14 }, (_, index) => {
    const x = index * 7;
    const y = 18 + Math.sin(index * 0.9 + seed) * 5 + (positive ? -index * 0.3 : index * 0.25);
    return `${x},${y.toFixed(1)}`;
  }).join(" ");
  return <svg viewBox="0 0 92 34" className="mt-2 h-8 w-full"><polyline points={points} fill="none" className={positive ? "stroke-primary" : "stroke-destructive"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function buildPortfolioSeries(total: number) {
  const labels = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  return labels.map((label, index) => {
    const wave = Math.sin(index * 0.9) * 0.16;
    const climb = 0.62 + index * 0.045;
    return { label, value: Math.max(1, total * (climb + wave)) };
  });
}

function ThesisCard({ holding, onUpdate }: { holding: Holding & { last: number; value: number; pnl: number; pnlPercent: number }; onUpdate: (patch: Partial<Holding>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    thesis: holding.thesis ?? "",
    invalidation: holding.invalidation ?? "",
    riskNotes: holding.riskNotes ?? "",
    buyMoreAt: String(holding.buyMoreAt ?? ""),
    trimAt: String(holding.trimAt ?? "")
  });

  useEffect(() => {
    setDraft({
      thesis: holding.thesis ?? "",
      invalidation: holding.invalidation ?? "",
      riskNotes: holding.riskNotes ?? "",
      buyMoreAt: String(holding.buyMoreAt ?? ""),
      trimAt: String(holding.trimAt ?? "")
    });
  }, [holding.id, holding.thesis, holding.invalidation, holding.riskNotes, holding.buyMoreAt, holding.trimAt]);

  const save = () => {
    onUpdate({
      thesis: draft.thesis,
      invalidation: draft.invalidation,
      riskNotes: draft.riskNotes,
      buyMoreAt: Number(draft.buyMoreAt) || undefined,
      trimAt: Number(draft.trimAt) || undefined
    });
    setEditing(false);
  };

  return (
    <div className="rounded-sm border border-border bg-background/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-data text-lg font-black text-white">{holding.symbol}</div>
          <div className="mt-1 label-caps">{holding.timeHorizon ?? "long-term"} / {holding.conviction ?? "watch"}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => editing ? save() : setEditing(true)}>{editing ? "Save" : "Edit"}</Button>
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <Textarea className="min-h-20 rounded-sm border-border bg-card font-data text-xs" value={draft.thesis} onChange={(event) => setDraft({ ...draft, thesis: event.target.value })} placeholder="Core bull thesis" />
          <Textarea className="min-h-16 rounded-sm border-border bg-card font-data text-xs" value={draft.invalidation} onChange={(event) => setDraft({ ...draft, invalidation: event.target.value })} placeholder="What breaks the thesis" />
          <Textarea className="min-h-16 rounded-sm border-border bg-card font-data text-xs" value={draft.riskNotes} onChange={(event) => setDraft({ ...draft, riskNotes: event.target.value })} placeholder="Risk notes" />
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9 rounded-sm border-border bg-card font-data text-xs" value={draft.buyMoreAt} onChange={(event) => setDraft({ ...draft, buyMoreAt: event.target.value })} placeholder="Buy more at" />
            <Input className="h-9 rounded-sm border-border bg-card font-data text-xs" value={draft.trimAt} onChange={(event) => setDraft({ ...draft, trimAt: event.target.value })} placeholder="Trim at" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <div className="label-caps">Core Thesis</div>
            <p className="mt-1 text-xs leading-5 text-zinc-300">{holding.thesis || "No thesis written yet."}</p>
          </div>
          <div>
            <div className="label-caps">Invalidation</div>
            <p className="mt-1 text-xs leading-5 text-zinc-300">{holding.invalidation || "No invalidation point set."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 font-data text-xs">
            <div><span className="text-muted-foreground">Buy more </span>{holding.buyMoreAt ? currency(holding.buyMoreAt) : "Unset"}</div>
            <div><span className="text-muted-foreground">Trim </span>{holding.trimAt ? currency(holding.trimAt) : "Unset"}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-cols-[minmax(0,1fr)_340px] xl:overflow-hidden max-md:p-3">
      <Panel>
        <PanelTitle title="terminal_preferences.config" />
        <div className="grid max-w-5xl grid-cols-2 gap-6 p-4 max-lg:grid-cols-1">
          <ConfigGroup title="Execution Defaults">
            <SliderRow label="Default Position Risk" value="1.5%" sliderValue={[1.5]} setSliderValue={() => undefined} min={0.25} max={5} step={0.25} />
            <SliderRow label="Alert Sensitivity" value="High" sliderValue={[82]} setSliderValue={() => undefined} min={0} max={100} step={1} />
            <button className="flex h-11 items-center justify-between border border-border bg-background px-3 font-data">Broker: Paper Terminal<ChevronDown className="size-4" /></button>
          </ConfigGroup>
          <ConfigGroup title="Interface">
            <SliderRow label="Panel Density" value="Compact" sliderValue={[88]} setSliderValue={() => undefined} min={0} max={100} step={1} />
            <SliderRow label="Chart Contrast" value="Terminal" sliderValue={[74]} setSliderValue={() => undefined} min={0} max={100} step={1} />
            <Button className="h-11 rounded-sm uppercase tracking-[0.14em]">Apply Settings</Button>
          </ConfigGroup>
        </div>
      </Panel>
      <Panel>
        <PanelTitle title="System Health" />
        <div className="flex flex-col gap-5 p-5">
          <MetricInline label="API State" value="Established" />
          <MetricInline label="Feed" value="NASDAQ L2 Live" />
          <MetricInline label="Latency" value="0.04ms" />
          <MetricInline label="Operator Tier" value="Platinum" />
        </div>
      </Panel>
    </div>
  );
}

function StrategyPage({ watchlist, onAddTrade }: { watchlist: WatchSymbol[]; onAddTrade: (row: AuditRow) => void }) {
  return <LabPage watchlist={watchlist} onAddTrade={onAddTrade} />;
}

function TradeField({ label, value, onChange, className }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 label-caps">{label}</div>
      <Input className="h-10 rounded-sm border-border bg-background font-data" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function AuditTable({ compact = false, rows = [], onEdit }: { compact?: boolean; rows?: AuditRow[]; onEdit?: (row: AuditRow, index: number) => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Ticker</TableHead><TableHead>Side</TableHead><TableHead>Price</TableHead><TableHead>Duration</TableHead><TableHead>R:R</TableHead><TableHead>Tag</TableHead><TableHead className="text-right">P&L</TableHead>{!compact ? <TableHead>Audit_Notes</TableHead> : null}{onEdit ? <TableHead className="text-right">Edit</TableHead> : null}</TableRow></TableHeader>
      <TableBody>{rows.slice(0, compact ? 3 : 12).map((r, index) => <TableRow key={`${r[0]}-${r[1]}-${r[6]}`}>{r.slice(0, compact ? 8 : 9).map((cell, i) => {
        const value = String(cell ?? "");
        return <TableCell key={`${r[0]}-${i}`} className={cn("font-data", i === 1 && "font-bold text-primary", i === 2 && (value === "BUY" ? "text-emerald-400" : "text-red-200"), i === 7 && (value.startsWith("+") ? "font-bold text-emerald-300" : value.startsWith("-") ? "font-bold text-red-200" : ""), i === 8 && "italic text-muted-foreground")}>{i === 6 ? <Badge variant="secondary" className="rounded-sm font-data">{value}</Badge> : value}</TableCell>;
      })}{onEdit ? <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onEdit(r, index)}>Edit</Button></TableCell> : null}</TableRow>)}</TableBody>
    </Table>
  );
}

function KpiCard({ title, value, meta, details, accent }: { title: string; value: string; meta: string; details: string[][]; accent?: "green" | "primary" }) {
  return (
    <Card className={cn("rounded-none border border-border bg-background py-0", accent === "primary" && "border-l-primary", accent === "green" && "border-l-emerald-400")}>
      <CardHeader className="px-4 pt-4"><div className="flex items-center justify-between gap-3"><span className="label-caps truncate">{title}</span><span className={cn("shrink-0 font-data text-sm", accent === "green" ? "text-emerald-400" : "text-muted-foreground")}>{meta}</span></div><CardTitle className={cn("truncate font-data text-xl font-normal xl:text-2xl", accent ? "text-emerald-400" : "text-white")}>{value}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 border-t border-border px-4 py-3">{details.map(([label, val]) => <MetricInline key={label} label={label} value={val} />)}</CardContent>
    </Card>
  );
}

function JournalMetric({ title, value, meta, green, bars }: { title: string; value: string; meta?: string; green?: boolean; bars?: boolean }) {
  return (
    <Panel className="p-3">
      <div className="flex justify-between label-caps"><span>{title}</span><span>{meta ?? "T30"}</span></div>
      <div className={cn("mt-3 truncate font-data text-xl font-bold text-white", green && "text-emerald-300")}>{value}</div>
      {bars ? <div className="mt-2 flex justify-end gap-1">{[10, 18, 24, 30, 40].map((h, i) => <div key={h} className={cn("w-4 bg-zinc-600", i === 3 && "bg-white")} style={{ height: h }} />)}</div> : null}
    </Panel>
  );
}

function SliderRow({ label, value, sliderValue, setSliderValue, min, max, step, checked }: { label: string; value: string; sliderValue: number[]; setSliderValue: (v: number[]) => void; min: number; max: number; step: number; checked?: boolean }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="text-sm text-zinc-200">{label}</span>
        <span className="flex min-w-24 items-center justify-end gap-2 font-data text-sm text-white">{value}{checked ? <span className="flex size-5 items-center justify-center bg-primary text-[9px] text-black">ON</span> : null}</span>
      </div>
      <Slider value={sliderValue} onValueChange={setSliderValue} min={min} max={max} step={step} />
    </div>
  );
}

function ConfigGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="mb-5 border-b border-border pb-2 text-lg uppercase text-zinc-300">{title}</h2><div className="flex flex-col gap-5">{children}</div></section>;
}

function MessageBlock({ icon: Icon, kicker, children }: { icon: typeof Cpu; kicker: string; children: ReactNode }) {
  return <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-4"><div className="flex size-10 items-center justify-center border border-blue-950 bg-card text-primary"><Icon className="size-4" /></div><div><div className="mb-2 font-data text-xs font-bold uppercase tracking-[0.16em] text-primary">{kicker}</div><div className="border-l border-border pl-4 text-sm leading-6 text-zinc-200">{children}</div></div></div>;
}

function FlowCard({ title, value, footer, green }: { title: string; value: string; footer: string; green?: boolean }) {
  return <div className="border border-blue-950 p-3"><div className="label-caps">{title}</div><div className={cn("mt-3 font-data text-xl text-white", green && "text-lime-400")}>{value}</div><Slider value={[green ? 78 : 62]} max={100} disabled className="mt-3" /><div className="label-caps mt-3">{footer}</div></div>;
}

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("min-w-0 overflow-hidden border border-border bg-card", className)}>{children}</section>;
}

function PanelTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-3"><h2 className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{title}</h2>{action ? <div className="shrink-0">{action}</div> : null}</div>;
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="label-caps truncate">{label}</div><div className="mt-1 truncate font-data text-sm text-white">{value}</div></div>;
}

function IconOnly({ icon: Icon, label }: { icon: typeof Search; label: string }) {
  return <Button variant="ghost" size="icon-sm" aria-label={label}><Icon data-icon="icon" /></Button>;
}

function StatusPill() {
  return <div className="hidden items-center gap-2 font-data text-xs text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />Status: Online</div>;
}

function FooterBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-[#050505] px-6 font-data text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
      <span>(c) 2024 QuantJournal Terminal</span>
      <span>System: Nominal&nbsp;&nbsp;&nbsp; Latency: 14ms&nbsp;&nbsp;&nbsp; <span className="text-emerald-400">NY_Exchange: Open</span></span>
    </footer>
  );
}
