import cors from "cors";
import express from "express";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const configuredMarketDataProvider = process.env.MARKET_DATA_PROVIDER ?? "auto";
const marketDataProvider = ["auto", "alpaca", "massive"].includes(configuredMarketDataProvider) ? configuredMarketDataProvider : "auto";
const alpacaBaseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
const alpacaFeed = process.env.ALPACA_FEED ?? "iex";
const alpacaWsUrl = process.env.ALPACA_WS_URL ?? `wss://stream.data.alpaca.markets/v2/${alpacaFeed}`;
const massiveBaseUrl = process.env.MASSIVE_BASE_URL ?? "https://api.massive.com";
const massiveWsUrl = process.env.MASSIVE_WS_URL ?? "wss://delayed.massive.com/stocks";
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const deepseekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const stockSymbols = new Set(["NVDA", "AAPL", "TSLA", "MSFT", "AMD"]);
const massiveCache = new Map();
const massiveSymbolMap = {
  ETHUSD: "X:ETHUSD",
  EURUSD: "C:EURUSD"
};

function envValue(...names) {
  return names.map((name) => process.env[name]).find(Boolean);
}

function massiveSymbol(symbol) {
  return massiveSymbolMap[symbol] ?? symbol;
}

function alpacaKeyPair() {
  const keyId = envValue("ALPACA_API_KEY_ID", "ALPACA_API_KEY");
  const secretKey = envValue("ALPACA_API_SECRET_KEY", "ALPACA_SECRET_KEY");
  return { keyId, secretKey };
}

function shouldUseAlpaca() {
  const { keyId, secretKey } = alpacaKeyPair();
  return Boolean(keyId && secretKey && (marketDataProvider === "auto" || marketDataProvider === "alpaca"));
}

function requireMarketDataKey(res) {
  if (marketDataProvider === "alpaca") {
    if (shouldUseAlpaca()) return "alpaca";
    res.status(503).json({ error: "Alpaca market data is selected but ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are not configured." });
    return null;
  }

  const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY", "polygon");
  if (marketDataProvider === "massive") {
    if (token) return "massive";
    res.status(503).json({ error: "Massive market data is selected but MASSIVE_API_KEY or POLYGON_API_KEY is not configured." });
    return null;
  }

  if (shouldUseAlpaca()) return "alpaca";
  if (token) return "massive";

  res.status(503).json({ error: "Market data is not configured. Set Alpaca or Massive credentials." });
  return null;
}

function requireMassiveKey(res) {
  const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY", "polygon");
  if (!token) {
    res.status(503).json({ error: "MASSIVE_API_KEY is not configured" });
    return null;
  }
  return token;
}

async function fetchMassive(path, params = {}) {
  const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY", "polygon");
  const url = new URL(`${massiveBaseUrl}${path}`);
  Object.entries({ ...params, apiKey: token }).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const cacheKey = url.toString();
  const cached = massiveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 429 && cached) return cached.data;
    throw new Error(`Massive returned ${response.status}`);
  }
  const data = await response.json();
  massiveCache.set(cacheKey, { data, expiresAt: Date.now() + 60_000 });
  return data;
}

async function fetchAlpaca(path, params = {}) {
  const { keyId, secretKey } = alpacaKeyPair();
  if (!keyId || !secretKey) throw new Error("Alpaca credentials are not configured");

  const url = new URL(`${alpacaBaseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Alpaca returned ${response.status}: ${body.slice(0, 180)}`);
  }
  return response.json();
}

function aggregateToCandle(item, resolution = "D") {
  return {
    time: resolution === "D" ? new Date(item.t).toISOString().slice(0, 10) : Math.floor(item.t / 1000),
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v ?? 0
  };
}

function alpacaTimeframe(resolution = "D") {
  if (resolution === "D") return "1Day";
  if (resolution === "60") return "1Hour";
  return `${Math.max(1, Number(resolution) || 1)}Min`;
}

function alpacaBarToCandle(bar, resolution = "D") {
  return {
    time: resolution === "D" ? new Date(bar.t).toISOString().slice(0, 10) : Math.floor(Date.parse(bar.t) / 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v ?? 0
  };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

async function quoteFromStooq(symbol) {
  if (!stockSymbols.has(symbol)) throw new Error("Stooq fallback is configured for U.S. stock symbols only");

  const response = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`);
  if (!response.ok) throw new Error(`Stooq returned ${response.status}`);

  const text = await response.text();
  const [headerLine, dataLine] = text.trim().split(/\r?\n/);
  if (!headerLine || !dataLine) throw new Error("Stooq did not return quote data");

  const headers = parseCsvLine(headerLine);
  const data = parseCsvLine(dataLine);
  const row = Object.fromEntries(headers.map((header, index) => [header, data[index]]));
  const last = Number(row.Close);
  const open = Number(row.Open);
  if (!Number.isFinite(last) || !last) throw new Error("Stooq quote was empty");

  const previousClose = Number.isFinite(open) && open ? open : last;
  return {
    symbol,
    last,
    open: previousClose,
    high: Number(row.High) || last,
    low: Number(row.Low) || last,
    previousClose,
    change: Number(last - previousClose),
    changePercent: Number(previousClose ? ((last - previousClose) / previousClose) * 100 : 0),
    timestamp: Date.parse(`${row.Date}T${row.Time}Z`) || Date.now(),
    source: "stooq-delayed-fallback"
  };
}

async function fetchMassiveCandles(symbol, resolution = "D", years = 1) {
  const to = new Date();
  const from = new Date(to);
  if (resolution === "D") {
    from.setFullYear(to.getFullYear() - years);
  } else {
    const intradayDays = { "1": 5, "5": 10, "15": 30, "60": 90 };
    from.setDate(to.getDate() - (intradayDays[resolution] ?? 30));
  }
  const formatDate = (date) => date.toISOString().slice(0, 10);
  const multiplier = resolution === "D" ? 1 : Math.max(1, Number(resolution) || 1);
  const timespan = resolution === "D" ? "day" : "minute";
  const ticker = massiveSymbol(symbol);
  const candles = await fetchMassive(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${formatDate(from)}/${formatDate(to)}`, {
    adjusted: true,
    sort: "asc",
    limit: 5000
  });
  if (!Array.isArray(candles.results) || !candles.results.length) return [];
  return candles.results.map((item) => aggregateToCandle(item, resolution));
}

async function fetchAlpacaCandles(symbol, resolution = "D") {
  if (!stockSymbols.has(symbol)) throw new Error("Alpaca candles are configured for U.S. stock symbols only");

  const to = new Date();
  const from = new Date(to);
  if (resolution === "D") {
    from.setFullYear(to.getFullYear() - 1);
  } else {
    const intradayDays = { "1": 5, "5": 10, "15": 30, "60": 90 };
    from.setDate(to.getDate() - (intradayDays[resolution] ?? 30));
  }

  const data = await fetchAlpaca(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
    timeframe: alpacaTimeframe(resolution),
    start: from.toISOString(),
    end: to.toISOString(),
    limit: 5000,
    adjustment: "split",
    feed: alpacaFeed,
    sort: "asc"
  });
  return (data.bars ?? []).map((bar) => alpacaBarToCandle(bar, resolution));
}

async function quoteFromAlpaca(symbol) {
  if (!stockSymbols.has(symbol)) throw new Error("Alpaca quote is configured for U.S. stock symbols only");

  const data = await fetchAlpaca("/v2/stocks/snapshots", {
    symbols: symbol,
    feed: alpacaFeed
  });
  const snapshot = data.snapshots?.[symbol] ?? data[symbol];
  if (!snapshot) throw new Error("Alpaca did not return a snapshot");

  const latestTrade = snapshot.latestTrade ?? {};
  const latestQuote = snapshot.latestQuote ?? {};
  const day = snapshot.dailyBar ?? {};
  const prevDay = snapshot.prevDailyBar ?? {};
  const minute = snapshot.minuteBar ?? {};
  const bidAskMid = latestQuote.bp && latestQuote.ap ? (Number(latestQuote.bp) + Number(latestQuote.ap)) / 2 : undefined;
  const last = Number(latestTrade.p ?? minute.c ?? bidAskMid ?? day.c ?? prevDay.c ?? 0);
  if (!Number.isFinite(last) || !last) throw new Error("Alpaca snapshot did not include a usable price");

  const previousClose = Number(prevDay.c ?? day.o ?? last);
  return {
    symbol,
    last,
    open: Number(day.o ?? last),
    high: Number(day.h ?? last),
    low: Number(day.l ?? last),
    previousClose,
    change: Number(last - previousClose),
    changePercent: Number(previousClose ? ((last - previousClose) / previousClose) * 100 : 0),
    timestamp: Date.parse(latestTrade.t ?? latestQuote.t ?? minute.t ?? day.t) || Date.now(),
    source: `alpaca-${alpacaFeed}`
  };
}

async function quoteFromLatestCandle(symbol) {
  const candles = await fetchMassiveCandles(symbol, "D", 1);
  const latest = candles.at(-1);
  const prior = candles.at(-2);
  if (!latest) throw new Error("Massive did not return fallback candle data");
  const previousClose = Number(prior?.close ?? latest.open ?? latest.close);
  const last = Number(latest.close);
  return {
    symbol,
    last,
    open: Number(latest.open),
    high: Number(latest.high),
    low: Number(latest.low),
    previousClose,
    change: Number(last - previousClose),
    changePercent: Number(previousClose ? ((last - previousClose) / previousClose) * 100 : 0),
    timestamp: Date.parse(String(latest.time)),
    source: "massive-aggs-fallback"
  };
}

function requireDeepseekKey(res) {
  const token = envValue("DEEPSEEK_API_KEY", "deepseek");
  if (!token) {
    res.status(503).json({ error: "DEEPSEEK_API_KEY is not configured" });
    return null;
  }
  return token;
}

async function askDeepseek(messages, temperature = 0.25) {
  const token = envValue("DEEPSEEK_API_KEY", "deepseek");
  const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model: deepseekModel,
      temperature,
      max_tokens: 900,
      messages
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek returned ${response.status}: ${body.slice(0, 240)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "No analysis returned.";
}

// ─── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ─── Market Data ───────────────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const provider = requireMarketDataKey(res);
  if (!provider) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  if (!stockSymbols.has(symbol)) {
    res.status(400).json({ error: "Quote snapshots are configured for U.S. stock symbols only" });
    return;
  }

  try {
    if (provider === "alpaca") {
      res.json(await quoteFromAlpaca(symbol));
      return;
    }

    const snapshot = await fetchMassive(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`);
    const ticker = snapshot.ticker ?? {};
    const day = ticker.day ?? {};
    const prevDay = ticker.prevDay ?? {};
    const min = ticker.min ?? {};
    const lastTrade = ticker.lastTrade ?? {};
    const last = Number(lastTrade.p ?? min.c ?? day.c ?? prevDay.c ?? 0);
    const previousClose = Number(prevDay.c ?? 0);
    res.json({
      symbol,
      last,
      open: Number(day.o ?? prevDay.o ?? last),
      high: Number(day.h ?? prevDay.h ?? last),
      low: Number(day.l ?? prevDay.l ?? last),
      previousClose,
      change: Number(ticker.todaysChange ?? (previousClose ? last - previousClose : 0)),
      changePercent: Number(ticker.todaysChangePerc ?? (previousClose ? ((last - previousClose) / previousClose) * 100 : 0)),
      timestamp: Number(ticker.updated ?? Date.now())
    });
  } catch (error) {
    if (marketDataProvider !== "auto") {
      res.status(502).json({ error: error.message, provider });
      return;
    }
    try {
      res.json(await quoteFromStooq(symbol));
    } catch (stooqError) {
      try {
        res.json(await quoteFromLatestCandle(symbol));
      } catch (fallbackError) {
        res.status(502).json({ error: `${error.message}; Stooq: ${stooqError.message}; candle fallback: ${fallbackError.message}` });
      }
    }
  }
});

app.get("/api/markets/news", async (req, res) => {
  const token = requireMassiveKey(res);
  if (!token) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  try {
    const data = await fetchMassive("/v2/reference/news", {
      ticker: massiveSymbol(symbol),
      order: "desc",
      sort: "published_utc",
      limit: 12
    });
    res.json(
      (data.results ?? []).slice(0, 12).map((item) => ({
        id: String(item.id ?? item.article_url ?? item.published_utc),
        symbol,
        headline: item.title,
        source: item.publisher?.name || "Massive",
        impact: item.insights?.some((insight) => insight.sentiment === "positive" || insight.sentiment === "negative") ? "high" : "medium",
        timestamp: item.published_utc ? new Date(item.published_utc).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "Live",
        summary: item.description || item.title
      }))
    );
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/markets/candles", async (req, res) => {
  const provider = requireMarketDataKey(res);
  if (!provider) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  const resolution = String(req.query.resolution ?? "D");

  try {
    const candles = provider === "alpaca" ? await fetchAlpacaCandles(symbol, resolution) : await fetchMassiveCandles(symbol, resolution);
    if (!candles.length) {
      res.status(502).json({ error: `${provider === "alpaca" ? "Alpaca" : "Massive"} did not return candle data` });
      return;
    }
    res.json(candles);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/markets/stream", (req, res) => {
  const provider = requireMarketDataKey(res);
  if (!provider) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  if (typeof WebSocket === "undefined") {
    res.status(501).json({ error: "WebSocket client is not available in this Node runtime" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  res.write(`event: status\ndata: ${JSON.stringify({ status: "connecting", symbol })}\n\n`);

  const upstream = new WebSocket(provider === "alpaca" ? alpacaWsUrl : massiveWsUrl);
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25_000);

  upstream.addEventListener("open", () => {
    if (provider === "alpaca") {
      const { keyId, secretKey } = alpacaKeyPair();
      upstream.send(JSON.stringify({ action: "auth", key: keyId, secret: secretKey }));
    } else {
      const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY", "polygon");
      upstream.send(JSON.stringify({ action: "auth", params: token }));
    }
  });

  upstream.addEventListener("message", (event) => {
    const messages = JSON.parse(String(event.data));
    const items = Array.isArray(messages) ? messages : [messages];
    for (const item of items) {
      if (provider === "alpaca") {
        if (item.T === "success" && item.msg === "authenticated") {
          upstream.send(JSON.stringify({ action: "subscribe", trades: [symbol], quotes: [symbol], bars: [symbol] }));
          res.write(`event: status\ndata: ${JSON.stringify({ status: "subscribed", symbol, provider })}\n\n`);
          continue;
        }
        if (item.T === "error") {
          res.write(`event: error\ndata: ${JSON.stringify({ error: item.msg ?? "Alpaca stream error" })}\n\n`);
          continue;
        }
        if (item.T === "b") {
          res.write(`event: candle\ndata: ${JSON.stringify({ symbol: item.S, time: Math.floor(Date.parse(item.t) / 1000), open: item.o, high: item.h, low: item.l, close: item.c, volume: item.v ?? 0 })}\n\n`);
        }
        if (item.T === "t") {
          res.write(`event: trade\ndata: ${JSON.stringify({ symbol: item.S, last: item.p, size: item.s, timestamp: Date.parse(item.t) })}\n\n`);
        }
        if (item.T === "q") {
          res.write(`event: quote\ndata: ${JSON.stringify({ symbol: item.S, bid: item.bp, ask: item.ap, timestamp: Date.parse(item.t) })}\n\n`);
        }
        continue;
      }

      if (item.status === "auth_success") {
        upstream.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol},T.${symbol},Q.${symbol}` }));
        res.write(`event: status\ndata: ${JSON.stringify({ status: "subscribed", symbol, provider })}\n\n`);
        continue;
      }
      if (item.status === "error") {
        res.write(`event: error\ndata: ${JSON.stringify({ error: item.message ?? "Massive stream error" })}\n\n`);
        continue;
      }
      if (item.ev === "AM") {
        res.write(`event: candle\ndata: ${JSON.stringify({ symbol: item.sym, time: Math.floor(item.e / 1000), open: item.o, high: item.h, low: item.l, close: item.c, volume: item.v ?? 0 })}\n\n`);
      }
      if (item.ev === "T") {
        res.write(`event: trade\ndata: ${JSON.stringify({ symbol: item.sym, last: item.p, size: item.s, timestamp: item.t })}\n\n`);
      }
      if (item.ev === "Q") {
        res.write(`event: quote\ndata: ${JSON.stringify({ symbol: item.sym, bid: item.bp, ask: item.ap, timestamp: item.t })}\n\n`);
      }
    }
  });

  upstream.addEventListener("error", () => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: `${provider === "alpaca" ? "Alpaca" : "Massive"} stream connection failed` })}\n\n`);
  });

  upstream.addEventListener("close", () => {
    res.write(`event: status\ndata: ${JSON.stringify({ status: "closed", symbol })}\n\n`);
    res.end();
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
});

// ─── AI ────────────────────────────────────────────────────────────────────────
app.post("/api/ai/analyze", async (req, res) => {
  const token = requireDeepseekKey(res);
  if (!token) return;

  const { symbol = "NVDA", quote, candles = [], news = [] } = req.body ?? {};
  try {
    const content = await askDeepseek([
      {
        role: "system",
        content: "You are a market analysis assistant inside a trading journal. Be concise, risk-aware, and never guarantee future prices. Return practical analysis for education, not financial advice."
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Analyze the selected market from the supplied quote, candles, and news. Include trend, momentum, key risk, and a watch plan.",
          symbol,
          quote,
          recentCandles: candles.slice(-80),
          news: news.slice(0, 8)
        })
      }
    ]);
    res.json({ model: deepseekModel, content });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  const token = requireDeepseekKey(res);
  if (!token) return;

  const { symbol = "NVDA", prompt = "", quote, candles = [], news = [], messages = [] } = req.body ?? {};
  if (!String(prompt).trim()) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }

  try {
    const content = await askDeepseek([
      {
        role: "system",
        content: "You are the AI analyst for a trading journal. Use only the supplied market context and conversation. If data is missing, say so. Do not provide certainty or personalized financial advice."
      },
      {
        role: "user",
        content: JSON.stringify({
          selectedSymbol: symbol,
          quote,
          recentCandles: candles.slice(-80),
          news: news.slice(0, 8),
          priorMessages: messages.slice(-8),
          operatorPrompt: prompt
        })
      }
    ]);
    res.json({ model: deepseekModel, content });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ─── Server ────────────────────────────────────────────────────────────────────
const port = Number(process.env.API_PORT ?? 8787);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`QuantJournal API listening on http://127.0.0.1:${port}`);
});
server.keepAliveTimeout = 65_000;
