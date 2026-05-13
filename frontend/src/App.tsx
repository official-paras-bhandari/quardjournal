import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CandlestickSeries, createChart, HistogramSeries, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
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
  Layers,
  LineChart,
  Maximize2,
  PanelTop,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  SquareTerminal,
  Target,
  WalletCards,
  Zap
} from "lucide-react";
import { candlesFor, initialHoldings, initialJournal, news as mockNews, watchlist } from "@/data/mock";
import { analyzeMarket, chatAboutMarket } from "@/lib/ai";
import { currency, number, signed } from "@/lib/format";
import { getMarketCandles, getMarketNews, getQuote, marketStreamUrl, type MarketQuote } from "@/lib/market";
import { TechnicalChart } from "@/components/technical-chart";
import type { Candle, Holding, NewsItem, SymbolKey, WatchSymbol } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type RouteKey = "dashboard" | "markets" | "intelligence" | "journal" | "portfolio" | "strategy" | "ai" | "settings";

const routes: Array<{ key: RouteKey; label: string; short: string; to: string; icon: typeof Grid2X2 }> = [
  { key: "dashboard", label: "Dashboard", short: "Dash", to: "/dashboard", icon: Grid2X2 },
  { key: "markets", label: "Chart", short: "Chart", to: "/markets", icon: LineChart },
  { key: "strategy", label: "Lab", short: "Lab", to: "/strategy", icon: ChartNoAxesCombined },
  { key: "journal", label: "Orders", short: "Orders", to: "/journal", icon: PanelTop },
  { key: "portfolio", label: "Portfolio", short: "Wallet", to: "/portfolio", icon: WalletCards },
  { key: "intelligence", label: "Markets", short: "Mkts", to: "/intelligence", icon: Activity },
  { key: "ai", label: "Chat", short: "Chat", to: "/ai", icon: Bot },
  { key: "settings", label: "Settings", short: "Set", to: "/settings", icon: Settings }
];

type AuditRow = [timestamp: string, ticker: string, side: string, price: string, duration: string, rr: string, tag: string, pnl: string, notes: string];

const defaultAuditRows: AuditRow[] = [
  ["2023.10.24 09:30:11", "NVDA", "BUY", "432.15", "12m 44s", "2.4", "#EMA-CROSS", "+$450.00", "breakout_confirmation_confirmed; vol_spike_detected"],
  ["2023.10.24 10:15:45", "TSLA", "SELL", "212.50", "04m 12s", "1.2", "#VWAP-REJECT", "-$120.00", "failed_breakdown; exit_early_trigger"],
  ["2023.10.24 11:45:02", "AAPL", "BUY", "173.20", "45m 18s", "4.1", "#TREND-FOLLOW", "+$890.50", "riding_vwap_trend; no_exit_signals_triggered"],
  ["2023.10.24 13:20:30", "MSFT", "BUY", "330.10", "08m 05s", "0.0", "#SCRATCH", "$0.00", "market_chop_detected; exit_break_even"],
  ["2023.10.23 15:45:19", "SPY", "SELL", "421.80", "1h 05m", "3.5", "#EOD-FADE", "+$1,200.00", "setup_perfect_execution; high_confidence_fade"]
];

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
};

const intervals = ["1", "5", "15", "60", "D"] as const;

function useMarketData(symbol: SymbolKey, resolution = "D") {
  const fallback = useMemo(() => candlesFor(symbol), [symbol]);
  const [candles, setCandles] = useState<Candle[]>(fallback);
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [marketNews, setMarketNews] = useState<NewsItem[]>(mockNews.filter((item) => item.symbol === symbol || item.symbol === "MARKET"));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "connecting" | "subscribed" | "closed" | "error">("idle");

  useEffect(() => {
    let active = true;
    setCandles(fallback);
    setMarketNews(mockNews.filter((item) => item.symbol === symbol || item.symbol === "MARKET"));
    setIsLoading(true);
    setError(null);
    Promise.allSettled([getMarketCandles(symbol, resolution), getQuote(symbol), getMarketNews(symbol)]).then((results) => {
      if (!active) return;
      const [candleResult, quoteResult, newsResult] = results;
      if (candleResult.status === "fulfilled" && candleResult.value.length) setCandles(candleResult.value);
      if (quoteResult.status === "fulfilled") setQuote(quoteResult.value);
      if (newsResult.status === "fulfilled" && newsResult.value.length) setMarketNews(newsResult.value);
      const rejected = results.find((result) => result.status === "rejected");
      setError(rejected && rejected.status === "rejected" ? rejected.reason.message : null);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fallback, resolution, symbol]);

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

export default function App() {
  const [journalRows, setJournalRows] = useState<AuditRow[]>(defaultAuditRows);
  const [portfolioRows, setPortfolioRows] = useState<Holding[]>(initialHoldings);
  const [simTick, setSimTick] = useState(0);

  // Simulate live price ticking for mock data feel
  useEffect(() => {
    const timer = setInterval(() => setSimTick((s) => s + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const liveWatchlist = useMemo(() => {
    return watchlist.map((item) => {
      const drift = (Math.sin(simTick + item.symbol.length) * 0.05);
      const newLast = item.last + drift;
      return {
        ...item,
        last: newLast,
        change: item.change + drift,
        changePercent: item.changePercent + (drift / item.last) * 100
      };
    });
  }, [simTick]);

  const addJournalEntry = (row: AuditRow) => setJournalRows((prev) => [row, ...prev]);
  const addPortfolioHolding = (holding: Omit<Holding, "id">) => setPortfolioRows((prev) => [{ ...holding, id: crypto.randomUUID() }, ...prev]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<TerminalShell active="dashboard"><DashboardPage journal={journalRows} portfolio={portfolioRows} onAddTrade={addJournalEntry} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/markets" element={<TerminalShell active="markets"><MarketsPage portfolio={portfolioRows} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/intelligence" element={<TerminalShell active="intelligence"><IntelligencePage watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/journal" element={<TerminalShell active="journal"><JournalPage rows={journalRows} onRowsChange={setJournalRows} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/portfolio" element={<TerminalShell active="portfolio"><PortfolioPage rows={portfolioRows} onRowsChange={setPortfolioRows} watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/strategy" element={<TerminalShell active="strategy"><StrategyPage watchlist={liveWatchlist} onAddTrade={addJournalEntry} /></TerminalShell>} />
        <Route path="/ai" element={<TerminalShell active="ai"><AiPage watchlist={liveWatchlist} /></TerminalShell>} />
        <Route path="/settings" element={<TerminalShell active="settings"><SettingsPage /></TerminalShell>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function TerminalShell({ active, children }: { active: RouteKey; children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <SideRail active={active} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar active={active} />
        <main className="min-h-0 flex-1 overflow-hidden max-md:overflow-auto">{children}</main>
        <FooterBar />
      </div>
    </div>
  );
}

function TopBar({ active }: { active: RouteKey }) {
  const title = active === "ai" ? "QUANTCORE" : active === "journal" ? "AUDIT TERMINAL // 2024.V4" : "QuantJournal";

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-[#050505] px-5 max-lg:px-3 max-md:h-auto max-md:min-h-14 max-md:flex-wrap max-md:py-2">
      <div className="flex min-w-[170px] items-center gap-3 border-r border-border pr-5 max-md:min-w-0 max-md:border-r-0 max-md:pr-0">
        <span className="size-2.5 rounded-sm bg-primary shadow-[0_0_18px_hsl(var(--primary))]" />
        <span className="truncate text-xl font-black tracking-tight text-white max-md:text-base">{title}</span>
      </div>
      <div className="ml-5 flex min-w-0 flex-1 items-center gap-5 max-lg:ml-0 max-md:order-3 max-md:basis-full">
        {active === "ai" ? (
          <div className="hidden items-center gap-3 md:flex">
            <span className="label-caps">Active Asset</span>
            <span className="font-data text-lg font-bold text-primary">$NVDA</span>
            <Badge variant="outline" className="rounded-sm"><span className="mr-1 size-1.5 rounded-full bg-primary" />Live</Badge>
          </div>
        ) : null}
        <div className="relative w-full max-w-[440px] max-md:max-w-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
          <Input className="h-9 rounded-sm border-border bg-background pl-10 font-data text-sm" readOnly value={active === "dashboard" ? "Search instrument, order, thread..." : active === "strategy" ? "Search Tickers (AAPL, NVDA)" : "CMD+K to search"} />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 max-md:gap-1">
        <StatusPill />
        <span className="max-[520px]:hidden"><IconOnly icon={Bell} label="Alerts" /></span>
        <IconOnly icon={Settings} label="Settings" />
        {active !== "dashboard" ? <span className="max-[520px]:hidden"><IconOnly icon={CircleUserRound} label="Operator" /></span> : null}
      </div>
    </header>
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

function DashboardPage({ journal, portfolio, onAddTrade, watchlist }: { journal: AuditRow[]; portfolio: Holding[]; onAddTrade: (row: AuditRow) => void; watchlist: WatchSymbol[] }) {
  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-rows-[150px_minmax(0,1fr)_220px] xl:overflow-hidden max-md:p-3">
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard title="Portfolio Value" value="$1,245,680.00" meta="+1.24%" details={[["Sharpe", "2.41"], ["Beta (SPX)", "0.88"]]} accent="green" />
        <KpiCard title="Daily P&L" value="+$15,320.50" meta="Realized" details={[["Max Drawdown", "-4.2%"], ["Daily VAR", "$2,410"]]} accent="primary" />
        <KpiCard title="Risk Management" value="94.2%" meta="Utilization" details={[["Volatility (ATR)", "1.24"], ["Margin Level", "Nominal"]]} />
        <KpiCard title="Active Exposure" value="14 Positions" meta="8L / 6S" details={[["Net Delta", "+450.2"], ["Avg Holding", "4.2d"]]} />
      </div>
      <div className="grid min-h-0 grid-cols-[420px_minmax(0,1fr)_320px] gap-4 max-xl:grid-cols-1">
        <WatchlistMatrix watchlist={watchlist} />
        <TradeChartPanel />
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

  const execute = () => {
    const selected = watchlist.find((item) => item.symbol === ticker) ?? watchlist[0];
    onAdd([
      new Date().toISOString().slice(0, 19).replace("T", " "),
      ticker,
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
          <Select value={ticker} onValueChange={setTicker}>
            <SelectTrigger className="h-8 rounded-sm bg-background font-data text-xs">
              <SelectValue />
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
        <Button onClick={execute} className="h-8 w-full rounded-sm text-[10px] font-bold uppercase tracking-widest">Execute Intent</Button>
      </div>
    </Panel>
  );
}

function WatchlistMatrix({ watchlist }: { watchlist: WatchSymbol[] }) {
  return (
    <Panel className="min-h-0">
      <PanelTitle title="Technical Watchlist" action={<Button variant="ghost" size="icon-sm"><Crosshair data-icon="icon" /></Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Vol (24h)</TableHead>
            <TableHead className="text-right">RSI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {watchlist.slice(0, 5).map((item) => (
            <TableRow key={item.symbol} className={cn(item.symbol === "AAPL" && "bg-primary/10")}>
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

function LabPage({ watchlist, onAddTrade }: { watchlist: WatchSymbol[]; onAddTrade: (row: AuditRow) => void }) {
  const [simulationRows, setSimulationRows] = useState<AuditRow[]>(defaultAuditRows.slice(0, 3));
  const addSimulation = (row: AuditRow) => {
    setSimulationRows([row, ...simulationRows]);
    onAddTrade(row);
  };

  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-cols-[420px_minmax(0,1fr)] xl:overflow-hidden max-md:p-3">
      <StrategyConfig onRunSimulation={addSimulation} watchlist={watchlist} />
      <div className="grid min-h-0 gap-4 xl:grid-rows-[minmax(0,1fr)_360px]">
        <Panel className="min-h-0">
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <ToggleGroup type="single" defaultValue="5m" className="rounded-sm border border-border bg-background">
              {["1m", "5m", "1h", "1d"].map((item) => <ToggleGroupItem key={item} value={item} className="rounded-sm font-data text-xs">{item}</ToggleGroupItem>)}
            </ToggleGroup>
            <div className="flex items-center gap-5 font-data text-sm"><span>RVOL: 1.84</span><span className="text-emerald-400">Profit Factor: 2.15</span><Maximize2 className="size-4" /><Camera className="size-4" /></div>
          </div>
          <div className="relative h-[calc(100%-48px)]">
            <MarketSvg />
            <Badge className="absolute left-[30%] top-[44%] rounded-none bg-emerald-500 text-black">B: VWAP_TOUCH</Badge>
            <Badge variant="destructive" className="absolute left-[52%] top-[31%] rounded-none">S: LVN_REJECTION</Badge>
          </div>
        </Panel>
        <Panel>
          <PanelTitle title="Simulation Runs" action={<Button variant="outline" size="sm">Export CSV</Button>} />
          <AuditTable compact rows={simulationRows} />
        </Panel>
      </div>
    </div>
  );
}

function StrategyConfig({ onRunSimulation, watchlist }: { onRunSimulation: (row: AuditRow) => void; watchlist: WatchSymbol[] }) {
  const [ema, setEma] = useState([9]);
  const [rvol, setRvol] = useState([1.5]);
  const [risk, setRisk] = useState([500]);
  const [correlation, setCorrelation] = useState([82]);
  const [atr, setAtr] = useState([2]);
  const [scenario, setScenario] = useState({
    ticker: "NVDA",
    name: "VWAP Retest",
    entry: "VWAP reclaim with RSI divergence",
    exit: "Trim at 2R, invalidate below anchor low"
  });
  const selected = watchlist.find((item) => item.symbol === scenario.ticker) ?? watchlist[0];
  const runSimulation = () => {
    onRunSimulation([
      new Date().toISOString().slice(0, 19).replace("T", " "),
      scenario.ticker,
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
            <Select value={scenario.ticker} onValueChange={(ticker) => setScenario({ ...scenario, ticker })}>
              <SelectTrigger className="h-10 w-full rounded-sm border-border bg-background font-data">
                <SelectValue placeholder="Select watchlist stock" />
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
            <SliderRow label="Sector Correlation (SPY)" value={`${correlation[0] / 100}`} sliderValue={correlation} setSliderValue={setCorrelation} min={0} max={100} step={1} checked />
            <SliderRow label="Relative Volume (RVOL)" value={rvol[0].toFixed(1)} sliderValue={rvol} setSliderValue={setRvol} min={0.5} max={3} step={0.1} />
          </ConfigGroup>
          <ConfigGroup title="Risk Architecture">
            <SliderRow label="ATR Stop Multiplier" value={atr[0].toFixed(1)} sliderValue={atr} setSliderValue={setAtr} min={0.5} max={4} step={0.1} />
            <SliderRow label="Risk Per Trade ($)" value={String(risk[0])} sliderValue={risk} setSliderValue={setRisk} min={100} max={2000} step={50} />
            <div className="border border-border bg-card p-3">
              <div className="flex items-center justify-between label-caps"><span>Calculated Position Size</span><span className="text-primary">Auto-calc</span></div>
              <div className="mt-3 flex items-end justify-between"><span className="font-data text-3xl font-bold text-white">142</span><span className="text-muted-foreground">SHARES</span></div>
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

function AiPage({ watchlist }: { watchlist: WatchSymbol[] }) {
  const [prompt, setPrompt] = useState("");
  const [symbol, setSymbol] = useState<SymbolKey>("NVDA");
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { candles, quote, marketNews, error } = useMarketData(symbol, "D");
  const selected = selectedQuote(symbol, quote);
  const [messages, setMessages] = useState<ChatUiMessage[]>([
    {
      id: "system",
      type: "system",
      text: "Operational context locked to $NVDA. Massive market data is synchronized when API keys are configured. Specify analysis vectors."
    },
    {
      id: "operator",
      type: "operator",
      text: "Analyze price action over the last 4 hours. Cross-reference institutional accumulation near VWAP with 15m RSI momentum."
    },
    {
      id: "analysis",
      type: "analysis",
      text: "Aggregating real-time flow data. Institutional dark pool liquidity is highly concentrated at $889.10. 15m RSI shows hidden bullish divergence during the last retest of the VWAP anchor."
    }
  ]);
  const runPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSending) return;
    const nextMessages = [...messages, { id: crypto.randomUUID(), type: "operator" as const, text: trimmed }];
    setMessages(nextMessages);
    setPrompt("");
    setIsSending(true);
    chatAboutMarket({
      symbol,
      quote: selected,
      candles,
      news: marketNews,
      prompt: trimmed,
      messages: nextMessages.map((message) => ({ role: message.type === "operator" ? "user" : "assistant", content: message.text }))
    }).then((result) => {
      setMessages((current) => [...current, { id: crypto.randomUUID(), type: "analysis", text: result.content }]);
    }).catch((err) => {
      setMessages((current) => [...current, { id: crypto.randomUUID(), type: "analysis", text: err instanceof Error ? err.message : "AI request failed." }]);
    }).finally(() => {
      setIsSending(false);
    });
  };
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);
  useEffect(() => {
    setMessages((current) => [
      { id: crypto.randomUUID(), type: "system", text: `Operational context switched to $${symbol}. ${error ? "Using local fallback market data until Massive is available." : "Massive market context is active."}` },
      ...current.filter((message) => message.type !== "system").slice(-6)
    ]);
  }, [error, symbol]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden max-xl:grid-cols-1 max-xl:overflow-auto">
      <div className="flex min-h-0 flex-col">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-5 py-2 label-caps max-md:flex-wrap max-md:px-3">
          <span><span className="mr-2 inline-block size-2 rounded-full bg-muted-foreground" />AI Engine: DeepSeek V4 | Active: ${symbol}</span>
          <div className="flex items-center gap-4">
            <span className="max-md:hidden">Price: {currency(selected.last)}&nbsp;&nbsp; Move: {signed(selected.changePercent, "%")}</span>
            <Button variant="ghost" size="sm" onClick={() => setMessages([])}>Clear Chat</Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-5 p-5 max-md:p-3">
            {messages.map((message) => {
              if (message.type === "system") {
                return <MessageBlock key={message.id} icon={Cpu} kicker="QJ_CORE_SYSTEM  14:02:44.201">{renderTickerText(message.text)}</MessageBlock>;
              }
              if (message.type === "operator") {
                return <div key={message.id} className="self-end max-w-2xl border-r border-border bg-card/40 p-4 pr-5 text-right text-sm leading-6 text-white">{message.text}</div>;
              }
              return (
                <MessageBlock key={message.id} icon={ChartNoAxesCombined} kicker="ANALYSTS_OUTPUT  14:05:18.115">
                  <div className="border border-blue-950 bg-card p-4">
                    <p className="text-sm leading-6">{renderTickerText(message.text)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
                      <FlowCard title="VWAP Anchor Analysis" value="$889.10" footer="Vol Strength: High 78.2% Absorption" />
                      <FlowCard title="Dark Pool Flow" value="+1.42B" footer="Bullish Conviction Institutional Tier" green />
                    </div>
                    <div className="mt-4 border-t border-blue-950 pt-4"><div className="grid grid-cols-3 gap-5 max-sm:grid-cols-1"><MetricInline label="Prob. Upside" value="82.4%" /><MetricInline label="Delta Neutral" value="0.042" /><MetricInline label="Gamma Exposure" value="+2.1M" /></div></div>
                  </div>
                </MessageBlock>
              );
            })}
            {!messages.length ? (
              <Panel className="p-8 text-center">
                <div className="label-caps">Chat Cleared</div>
                <p className="mt-2 text-sm text-muted-foreground">Enter a new command below to start a fresh analysis thread.</p>
              </Panel>
            ) : null}
            <div ref={endRef} />
          </div>
        </ScrollArea>
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3 border border-blue-950 bg-background p-2 max-sm:flex-wrap">
            <span className="font-data text-primary">$</span>
            <Input
              className="h-9 min-w-0 flex-1 border-0 bg-transparent font-data"
              placeholder="Awaiting next command..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runPrompt();
              }}
            />
            <Button onClick={runPrompt} disabled={isSending} className="rounded-sm px-5 uppercase tracking-[0.14em] max-sm:w-full">{isSending ? "Thinking" : "Run Prompt"}</Button>
          </div>
        </div>
      </div>
      <DeepDivePanel symbol={symbol} selected={selected} candles={candles} onSymbolChange={setSymbol} dataError={error} />
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

function JournalPage({ rows, onRowsChange, watchlist }: { rows: AuditRow[]; onRowsChange: (rows: AuditRow[]) => void; watchlist: WatchSymbol[] }) {
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
      onRowsChange([nextRow, ...rows]);
    } else {
      onRowsChange(rows.map((row, index) => index === editingIndex ? nextRow : row));
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



function PortfolioPage({ rows, onRowsChange, watchlist }: { rows: Holding[]; onRowsChange: (rows: Holding[]) => void; watchlist: WatchSymbol[] }) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ symbol: "NVDA" as SymbolKey, shares: 100, averageCost: 850.42 });

  const holdings = useMemo(() => rows.map((holding) => {
    const quote = watchlist.find((item) => item.symbol === holding.symbol) ?? watchlist[0];
    const value = holding.shares * quote.last;
    const pnl = value - holding.shares * holding.averageCost;
    return { ...holding, last: quote.last, value, pnl };
  }), [rows, watchlist]);

  const total = holdings.reduce((sum, row) => sum + row.value, 0);
  const pnl = holdings.reduce((sum, row) => sum + row.pnl, 0);

  const saveHolding = () => {
    onRowsChange([{ id: crypto.randomUUID(), ...draft }, ...rows]);
    setShowForm(false);
  };

  return (
    <div className="grid min-h-full gap-4 overflow-auto p-4 xl:h-full xl:grid-rows-[140px_minmax(0,1fr)] xl:overflow-hidden max-md:p-3">
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard title="Portfolio Equity" value={currency(total)} meta="+2.18%" details={[["Holdings", String(holdings.length)], ["Cash Buffer", "18.4%"]]} accent="primary" />
        <KpiCard title="Open P&L" value={currency(pnl)} meta="Unrealized" details={[["Best", "NVDA"], ["Worst", "AAPL"]]} accent="green" />
        <KpiCard title="Exposure" value="72.6%" meta="Allocated" details={[["Tech", "64%"], ["Index", "18%"]]} />
        <KpiCard title="Risk Budget" value="0.84R" meta="Nominal" details={[["VAR", "$2,410"], ["Heat", "Low"]]} />
      </div>

      {showForm ? (
        <Panel className="p-4">
          <PanelTitle title="Add New Holding" action={<Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>} />
          <div className="mt-4 grid grid-cols-4 gap-4 max-sm:grid-cols-1">
            <div>
              <div className="mb-2 label-caps">Symbol</div>
              <Select value={draft.symbol} onValueChange={(val) => setDraft({ ...draft, symbol: val as SymbolKey })}>
                <SelectTrigger className="h-10 w-full rounded-sm border-border bg-background font-data">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {watchlist.map((item) => <SelectItem key={item.symbol} value={item.symbol}>{item.symbol}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <TradeField label="Shares" value={String(draft.shares)} onChange={(val) => setDraft({ ...draft, shares: Number(val) })} />
            <TradeField label="Avg Cost" value={String(draft.averageCost)} onChange={(val) => setDraft({ ...draft, averageCost: Number(val) })} />
            <div className="flex items-end">
              <Button onClick={saveHolding} className="h-10 w-full rounded-sm font-bold uppercase tracking-widest">Add to Portfolio</Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4 max-xl:grid-cols-1">
        <Panel className="min-h-0">
          <PanelTitle title="portfolio_positions.json" action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setShowForm(true)}><Plus className="mr-1 size-3" />Add Holding</Button><Button variant="outline" size="sm"><Download data-icon="inline-start" />Export</Button></div>} />
          <Table>
            <TableHeader><TableRow><TableHead>Ticker</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Avg Entry</TableHead><TableHead className="text-right">Mark</TableHead><TableHead className="text-right">Market Value</TableHead><TableHead className="text-right">P&L</TableHead></TableRow></TableHeader>
            <TableBody>{holdings.map((row) => <TableRow key={row.id}><TableCell className="font-data font-bold text-primary">{row.symbol}</TableCell><TableCell className="text-muted-foreground">{watchlist.find((item) => item.symbol === row.symbol)?.name}</TableCell><TableCell className="text-right font-data">{number(row.shares)}</TableCell><TableCell className="text-right font-data">{currency(row.averageCost)}</TableCell><TableCell className="text-right font-data">{currency(row.last)}</TableCell><TableCell className="text-right font-data">{currency(row.value)}</TableCell><TableCell className={cn("text-right font-data font-bold", row.pnl >= 0 ? "text-emerald-300" : "text-red-200")}>{currency(row.pnl)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </Panel>
        <Panel>
          <PanelTitle title="Allocation Matrix" />
          <div className="flex flex-col gap-5 p-5">
            {holdings.map((row) => {
              const pct = total ? Math.round((row.value / total) * 100) : 0;
              return (
                <div key={row.id}>
                  <div className="mb-2 flex justify-between font-data text-sm"><span className="text-white">{row.symbol}</span><span className="text-primary">{pct}%</span></div>
                  <div className="h-2 bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            <div className="mt-4 border border-border bg-background p-4">
              <div className="label-caps">Correlation Guard</div>
              <div className="mt-3 font-data text-3xl text-white">0.71</div>
              <Slider value={[71]} max={100} disabled className="mt-5" />
            </div>
          </div>
        </Panel>
      </div>
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

function AuditTable({ compact = false, rows = defaultAuditRows, onEdit }: { compact?: boolean; rows?: AuditRow[]; onEdit?: (row: AuditRow, index: number) => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Ticker</TableHead><TableHead>Side</TableHead><TableHead>Price</TableHead><TableHead>Duration</TableHead><TableHead>R:R</TableHead><TableHead>Tag</TableHead><TableHead className="text-right">P&L</TableHead>{!compact ? <TableHead>Audit_Notes</TableHead> : null}{onEdit ? <TableHead className="text-right">Edit</TableHead> : null}</TableRow></TableHeader>
      <TableBody>{rows.slice(0, compact ? 3 : 12).map((r, index) => <TableRow key={`${r[0]}-${r[1]}-${r[6]}`}>{r.slice(0, compact ? 8 : 9).map((cell, i) => <TableCell key={`${r[0]}-${i}`} className={cn("font-data", i === 1 && "font-bold text-primary", i === 2 && (cell === "BUY" ? "text-emerald-400" : "text-red-200"), i === 7 && (cell.startsWith("+") ? "font-bold text-emerald-300" : cell.startsWith("-") ? "font-bold text-red-200" : ""), i === 8 && "italic text-muted-foreground")}>{i === 6 ? <Badge variant="secondary" className="rounded-sm font-data">{cell}</Badge> : cell}</TableCell>)}{onEdit ? <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onEdit(r, index)}>Edit</Button></TableCell> : null}</TableRow>)}</TableBody>
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
