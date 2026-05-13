import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, CrosshairMode, HistogramSeries, LineSeries, createChart, type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { ArrowUpDown, ChartNoAxesCombined, Crosshair, Eraser, LineChart, Minus, Pencil, Search, Trash2, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { watchlist } from "@/data/mock";
import { cn } from "@/lib/utils";
import { ema, lastPoint, macd, rsi, sma, vwap } from "@/lib/technical";
import type { Candle, SymbolKey, WatchSymbol } from "@/lib/types";

type DrawMode = "none" | "trendline" | "hline" | "note";
type Drawing =
  | { id: string; kind: "trendline"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { id: string; kind: "hline"; y: number }
  | { id: string; kind: "note"; x: number; y: number; text: string };

type TechnicalChartProps = {
  symbol: SymbolKey;
  candles: Candle[];
  quote?: WatchSymbol | null;
  resolution: string;
  onResolutionChange: (resolution: string) => void;
  onSymbolChange: (symbol: SymbolKey) => void;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  analysis?: string | null;
  streamState?: string;
  dataError?: string | null;
};

const indicatorOptions = [
  { key: "ema9", label: "EMA 9" },
  { key: "ema21", label: "EMA 21" },
  { key: "sma50", label: "SMA 50" },
  { key: "vwap", label: "VWAP" }
] as const;

export function TechnicalChart({
  symbol,
  candles,
  quote,
  resolution,
  onResolutionChange,
  onSymbolChange,
  onAnalyze,
  isAnalyzing,
  analysis,
  streamState,
  dataError
}: TechnicalChartProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [enabledIndicators, setEnabledIndicators] = useState<string[]>(["ema9", "ema21", "vwap"]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pendingPoint = useRef<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);

  const selectedQuote = quote ?? watchlist.find((item) => item.symbol === symbol) ?? watchlist[0];
  const chartLast = candles.at(-1)?.close ?? selectedQuote.last;
  const rsiValue = lastPoint(rsi(candles));
  const macdValue = macd(candles);
  const macdLast = lastPoint(macdValue.macdLine);
  const signalLast = lastPoint(macdValue.signalLine);

  const technicalData = useMemo(() => ({
    ema9: ema(candles, 9),
    ema21: ema(candles, 21),
    sma50: sma(candles, 50),
    vwap: vwap(candles)
  }), [candles]);

  useEffect(() => {
    if (!chartHostRef.current) return;
    const chart = createChart(chartHostRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fca5a5",
      borderUpColor: "#34d399",
      borderDownColor: "#fca5a5",
      wickUpColor: "#34d399",
      wickDownColor: "#fca5a5",
      lastValueVisible: true,
      priceLineVisible: true
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      visible: true,
      color: "rgba(192,193,255,0.28)",
      lastValueVisible: false,
      priceLineVisible: false
    });
    const ema9Series = chart.addSeries(LineSeries, {
      color: "#fbbf24",
      lineWidth: 2,
      visible: true,
      lastValueVisible: true,
      priceLineVisible: false,
      title: "EMA 9"
    });
    const ema21Series = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      visible: true,
      lastValueVisible: true,
      priceLineVisible: false,
      title: "EMA 21"
    });
    const sma50Series = chart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 2,
      visible: false,
      lastValueVisible: true,
      priceLineVisible: false,
      title: "SMA 50"
    });
    const vwapSeries = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 2,
      visible: true,
      lastValueVisible: true,
      priceLineVisible: false,
      title: "VWAP"
    });

    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9Ref.current = ema9Series;
    ema21Ref.current = ema21Series;
    sma50Ref.current = sma50Series;
    vwapRef.current = vwapSeries;

    const handleClick = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) return;
      if (drawMode === "trendline") {
        if (!pendingPoint.current) {
          pendingPoint.current = param.point ?? null;
          return;
        }
        const start = pendingPoint.current;
        const end = param.point;
        if (!start || !end) return;
        setDrawings((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            kind: "trendline",
            from: start,
            to: end
          }
        ]);
        pendingPoint.current = null;
        return;
      }
      if (drawMode === "hline") {
        const point = param.point;
        if (!point) return;
        setDrawings((current) => [...current, { id: crypto.randomUUID(), kind: "hline", y: point.y }]);
        return;
      }
      if (drawMode === "note") {
        const point = param.point;
        if (!point) return;
        setDrawings((current) => [...current, { id: crypto.randomUUID(), kind: "note", x: point.x, y: point.y, text: "Note" }]);
      }
    };

    chart.subscribeClick(handleClick);
    return () => {
      chart.unsubscribeClick(handleClick);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema9Ref.current = null;
      ema21Ref.current = null;
      sma50Ref.current = null;
      vwapRef.current = null;
    };
  }, [drawMode]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height)
      });
    });
    if (wrapRef.current) resizeObserver.observe(wrapRef.current);
    return () => resizeObserver.disconnect();
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
    ema9Ref.current?.setData(technicalData.ema9.map((point) => ({ time: point.time as Time, value: point.value })));
    ema21Ref.current?.setData(technicalData.ema21.map((point) => ({ time: point.time as Time, value: point.value })));
    sma50Ref.current?.setData(technicalData.sma50.map((point) => ({ time: point.time as Time, value: point.value })));
    vwapRef.current?.setData(technicalData.vwap.map((point) => ({ time: point.time as Time, value: point.value })));
    chartRef.current?.timeScale().fitContent();
  }, [candles, technicalData]);

  useEffect(() => {
    ema9Ref.current?.applyOptions({ visible: enabledIndicators.includes("ema9") });
    ema21Ref.current?.applyOptions({ visible: enabledIndicators.includes("ema21") });
    sma50Ref.current?.applyOptions({ visible: enabledIndicators.includes("sma50") });
    vwapRef.current?.applyOptions({ visible: enabledIndicators.includes("vwap") });
  }, [enabledIndicators]);

  const filteredWatchlist = watchlist.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || item.symbol.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-4 max-lg:py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-sm font-data">
                <Search data-icon="inline-start" />
                <span className="min-w-0 truncate">{symbol}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <div className="border-b border-border p-2">
                <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol or company" className="h-9 rounded-sm border-border bg-background font-data" />
              </div>
              <div className="max-h-72 overflow-auto p-1">
                {filteredWatchlist.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    className={cn("flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-muted", item.symbol === symbol && "bg-muted")}
                    onClick={() => {
                      onSymbolChange(item.symbol);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block font-data font-semibold text-white">{item.symbol}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
                    </span>
                    <span className={cn("font-data text-xs", item.changePercent >= 0 ? "text-emerald-300" : "text-red-200")}>{item.changePercent >= 0 ? "+" : ""}{item.changePercent.toFixed(2)}%</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Badge variant={selectedQuote.changePercent >= 0 ? "secondary" : "destructive"} className="rounded-sm font-data uppercase">
            {selectedQuote.changePercent >= 0 ? "Bid Holding" : "Supply Active"}
          </Badge>
          <ToggleGroup type="single" value={resolution} onValueChange={(value) => value && onResolutionChange(value)} className="rounded-none">
            {["1", "5", "15", "60", "D"].map((item) => (
              <ToggleGroupItem key={item} value={item} className="rounded-sm font-data text-xs">
                {item === "60" ? "1H" : item === "D" ? "D" : `${item}m`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="multiple" value={enabledIndicators} onValueChange={setEnabledIndicators} className="rounded-none">
            {indicatorOptions.map((item) => (
              <ToggleGroupItem key={item.key} value={item.key} className="rounded-sm font-data text-xs">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span className={cn("font-data", streamState === "subscribed" ? "text-emerald-400" : dataError ? "text-amber-300" : "text-muted-foreground")}>
            <span className={cn("mr-1 inline-block size-1.5 rounded-full", streamState === "subscribed" ? "bg-emerald-500" : dataError ? "bg-amber-300" : "bg-muted-foreground")} />
            {streamState === "subscribed" ? "Massive Stream" : dataError ? "Candle Fallback" : "Massive REST"}
          </span>
          {onAnalyze ? (
            <Button variant="outline" size="sm" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? "Analyzing" : "Analyze"}
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label="Chart settings">
            <ChartNoAxesCombined data-icon="icon" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fullscreen">
            <ArrowUpDown data-icon="icon" />
          </Button>
        </div>
      </div>
      <div ref={wrapRef} className="terminal-grid relative min-h-[320px] flex-1 overflow-hidden">
        <div ref={chartHostRef} className="h-full w-full" />
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
          <div className="bg-red-200 px-4 py-2 font-data text-xs font-bold text-black">{chartLast.toFixed(2)}</div>
        </div>
        <div className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
          <div className="border border-border bg-background/95 px-3 py-2 font-data text-xs text-zinc-200">
            RSI {rsiValue === null ? "n/a" : rsiValue.toFixed(1)}
          </div>
          <div className="border border-border bg-background/95 px-3 py-2 font-data text-xs text-zinc-200">
            MACD {macdLast === null ? "n/a" : macdLast.toFixed(2)} / {signalLast === null ? "n/a" : signalLast.toFixed(2)}
          </div>
          <div className="border border-border bg-background/95 px-3 py-2 font-data text-xs text-zinc-200">
            {selectedQuote.symbol} {selectedQuote.changePercent >= 0 ? "+" : ""}{selectedQuote.changePercent.toFixed(2)}%
          </div>
        </div>

        <div className="absolute left-3 top-16 z-20 flex flex-col gap-2">
          <Button variant={drawMode === "none" ? "secondary" : "outline"} size="icon-sm" onClick={() => setDrawMode("none")} aria-label="Crosshair">
            <Crosshair data-icon="icon" />
          </Button>
          <Button variant={drawMode === "trendline" ? "secondary" : "outline"} size="icon-sm" onClick={() => setDrawMode((current) => current === "trendline" ? "none" : "trendline")} aria-label="Trendline">
            <Pencil data-icon="icon" />
          </Button>
          <Button variant={drawMode === "hline" ? "secondary" : "outline"} size="icon-sm" onClick={() => setDrawMode((current) => current === "hline" ? "none" : "hline")} aria-label="Horizontal line">
            <Minus data-icon="icon" />
          </Button>
          <Button variant={drawMode === "note" ? "secondary" : "outline"} size="icon-sm" onClick={() => setDrawMode((current) => current === "note" ? "none" : "note")} aria-label="Text note">
            <Type data-icon="icon" />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setDrawings([])} aria-label="Clear drawings">
            <Trash2 data-icon="icon" />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => pendingPoint.current = null} aria-label="Cancel pending drawing">
            <Eraser data-icon="icon" />
          </Button>
        </div>

        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          {drawings.map((drawing) => {
            if (drawing.kind === "trendline") {
              return <line key={drawing.id} x1={drawing.from.x} y1={drawing.from.y} x2={drawing.to.x} y2={drawing.to.y} stroke="#e4e4e7" strokeWidth="2" strokeDasharray="4 4" />;
            }
            if (drawing.kind === "hline") {
              return <line key={drawing.id} x1="0" y1={drawing.y} x2={viewport.width} y2={drawing.y} stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 4" />;
            }
            return (
              <g key={drawing.id}>
                <rect x={drawing.x - 20} y={drawing.y - 20} width="40" height="26" rx="4" fill="rgba(15,15,15,0.9)" stroke="#3f3f46" />
                <text x={drawing.x} y={drawing.y - 2} textAnchor="middle" fill="#f4f4f5" fontSize="11" fontFamily="monospace">
                  {drawing.text}
                </text>
              </g>
            );
          })}
        </svg>
        {analysis ? (
          <div className="absolute bottom-3 left-3 right-3 z-20 max-h-32 overflow-auto border border-border bg-background/95 p-3 text-xs leading-5 text-zinc-200">
            <span className="mr-2 font-data text-primary">DEEPSEEK</span>
            {analysis}
          </div>
        ) : null}
      </div>
    </div>
  );
}
