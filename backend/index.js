import cors from "cors";
import crypto from "crypto";
import express from "express";
import { aiConfig, askModel, requireAiKey } from "./lib/ai-provider.js";
import { searchIndex } from "./lib/vector-store.js";
import { searchWeb } from "./lib/search-engine.js";
import {
  createContextAttachment,
  createMemory,
  deleteMemory,
  deletePortfolioItem,
  listMemories,
  listPortfolio,
  recordChatInteraction,
  retrieveMemoryContext,
  savePortfolioItem,
  updateMemory,
  listJournalEntries,
  saveJournalEntry,
  deleteJournalEntry
} from "./lib/memory-service.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const authSessions = new Map();
const authSessionTtlMs = Number(process.env.AUTH_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000);

const configuredMarketDataProvider = process.env.MARKET_DATA_PROVIDER ?? "auto";
const marketDataProvider = ["auto", "alpaca", "massive"].includes(configuredMarketDataProvider) ? configuredMarketDataProvider : "auto";
const alpacaBaseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
const alpacaFeed = process.env.ALPACA_FEED ?? "iex";
const alpacaWsUrl = process.env.ALPACA_WS_URL ?? `wss://stream.data.alpaca.markets/v2/${alpacaFeed}`;
const massiveBaseUrl = process.env.MASSIVE_BASE_URL ?? "https://api.massive.com";
const massiveWsUrl = process.env.MASSIVE_WS_URL ?? "wss://delayed.massive.com/stocks";
const stockSymbols = new Set(["NVDA", "AAPL", "TSLA", "MSFT", "AMD"]);
const massiveCache = new Map();
const massiveSymbolMap = {
  ETHUSD: "X:ETHUSD",
  EURUSD: "C:EURUSD"
};

function envValue(...names) {
  return names
    .map((name) => process.env[name]?.trim())
    .find((value) => value && !/^your_.+_here$/i.test(value));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authCredentials() {
  const username = envValue("APP_LOGIN_USERNAME", "ADMIN_USERNAME") || "admin";
  const password = envValue("APP_LOGIN_PASSWORD", "ADMIN_PASSWORD") || "quantcore";
  return { username, password };
}

function requestAuthToken(req) {
  const header = req.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return typeof req.query.authToken === "string" ? req.query.authToken : "";
}

function validateAuthToken(token) {
  const session = token ? authSessions.get(token) : null;
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  // Authentication disabled for verification version
  next();
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

function configuredMarketDataProviderOrNull() {
  if (marketDataProvider === "alpaca") return shouldUseAlpaca() ? "alpaca" : null;
  if (marketDataProvider === "massive") return envValue("MASSIVE_API_KEY", "POLYGON_API_KEY") ? "massive" : null;
  if (shouldUseAlpaca()) return "alpaca";
  if (envValue("MASSIVE_API_KEY", "POLYGON_API_KEY")) return "massive";
  return null;
}

async function fetchMassive(path, params = {}) {
  const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY");
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
  if (resolution === "M") return "1Month";
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

async function fetchStooqDailyCandles(symbol, years = 1) {
  if (!stockSymbols.has(symbol)) throw new Error("Stooq fallback is configured for U.S. stock symbols only");

  const response = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`);
  if (!response.ok) throw new Error(`Stooq returned ${response.status}`);

  const text = await response.text();
  const [headerLine, ...dataLines] = text.trim().split(/\r?\n/);
  if (!headerLine || !dataLines.length) throw new Error("Stooq did not return candle data");

  const headers = parseCsvLine(headerLine);
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);

  return dataLines
    .map((line) => Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index]])))
    .filter((row) => Date.parse(row.Date) >= from.getTime())
    .map((row) => ({
      time: row.Date,
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      volume: Number(row.Volume) || 0
    }))
    .filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

function aggregateCandles(candles, bucketKey) {
  const buckets = new Map();
  for (const candle of candles) {
    const key = bucketKey(candle.time);
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, { ...candle, time: key });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume ?? 0;
  }
  return [...buckets.values()];
}

async function fetchStooqCandles(symbol, resolution = "D") {
  const yearsByResolution = { D: 1, M: 5, "12M": 10, "60M": 20, MAX: 50 };
  const years = yearsByResolution[resolution] ?? 1;
  const daily = await fetchStooqDailyCandles(symbol, years);
  if (resolution === "M") return aggregateCandles(daily, (time) => time.slice(0, 7));
  if (resolution === "12M" || resolution === "60M" || resolution === "MAX") return aggregateCandles(daily, (time) => time.slice(0, 4));
  return daily;
}

async function fetchMassiveCandles(symbol, resolution = "D", years = 1) {
  const to = new Date();
  const from = new Date(to);
  
  let fetchYears = years;
  if (resolution === "12M" || resolution === "1Y") fetchYears = 10;
  if (resolution === "60M" || resolution === "5Y") fetchYears = 20;
  if (resolution === "MAX") fetchYears = 50;

  if (resolution === "D" || resolution === "M") {
    from.setFullYear(to.getFullYear() - fetchYears);
  } else {
    const intradayDays = { "1": 5, "5": 10, "15": 30, "60": 90 };
    from.setDate(to.getDate() - (intradayDays[resolution] ?? 30));
  }

  const formatDate = (date) => date.toISOString().slice(0, 10);
  
  let multiplier = 1;
  let timespan = "day";
  
  if (resolution === "M") {
    multiplier = 1;
    timespan = "month";
  } else if (resolution === "12M") {
    multiplier = 12;
    timespan = "month";
  } else if (resolution === "60M" || resolution === "MAX") {
    multiplier = 1;
    timespan = "year";
  } else if (resolution !== "D") {
    multiplier = Math.max(1, Number(resolution) || 1);
    timespan = "minute";
  }

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

// ─── Domain Gatekeeper ────────────────────────────────────────────────────────
function isMarketRelated(prompt) {
  const p = prompt.toLowerCase();
  const keywords = [
    "stock", "market", "trade", "price", "buy", "sell", "hold", "invest", "news", 
    "earnings", "call", "put", "option", "dividend", "cap", "volume", "indicator", 
    "chart", "level", "support", "resistance", "fomc", "fed", "rate", "inflation",
    "is it good", "should i", "why", "tell me more", "risk", "bullish", "bearish", "outlook",
    "long term", "short term", "macro", "future", "prediction", "analysis", "opinion",
    "portfolio", "valuation", "thesis", "conviction", "compound", "allocation", "investment"
  ];
  
  const hasKeyword = keywords.some(k => p.includes(k));
  const hasTicker = /\$[A-Z]{1,5}/.test(prompt.toUpperCase());

  return hasKeyword || hasTicker;
}

// ─── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const credentials = authCredentials();
  if (!credentials) {
    res.status(503).json({ error: "Login is not configured. Set APP_LOGIN_USERNAME and APP_LOGIN_PASSWORD." });
    return;
  }

  const username = String(req.body?.username ?? "");
  const password = String(req.body?.password ?? "");
  if (!safeEqual(username, credentials.username) || !safeEqual(password, credentials.password)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + authSessionTtlMs;
  authSessions.set(token, { username: credentials.username, expiresAt });
  res.json({ token, expiresAt, username: credentials.username });
});

app.get("/api/auth/session", requireAuth, (req, res) => {
  const credentials = authCredentials();
  res.json({ authenticated: true, username: credentials?.username ?? "user" });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  authSessions.delete(requestAuthToken(req));
  res.json({ ok: true });
});

app.use("/api", requireAuth);

// ─── Memory ───────────────────────────────────────────────────────────────────
app.get("/api/memory", async (req, res) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const includeDisabled = String(req.query.includeDisabled ?? "") === "true";
    res.json(await listMemories({ symbol, includeDisabled }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/memory", async (req, res) => {
  try {
    res.status(201).json(await createMemory(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/memory/:id", async (req, res) => {
  try {
    res.json(await updateMemory(req.params.id, req.body ?? {}));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.delete("/api/memory/:id", async (req, res) => {
  try {
    res.json(await deleteMemory(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Portfolio ─────────────────────────────────────────────────────────────────
app.get("/api/portfolio", async (req, res) => {
  try {
    res.json(await listPortfolio());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/portfolio", async (req, res) => {
  try {
    res.json(await savePortfolioItem(req.body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/portfolio/:id", async (req, res) => {
  try {
    res.json(await deletePortfolioItem(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Journal ─────────────────────────────────────────────────────────────────
app.get("/api/journal", async (req, res) => {
  try {
    res.json(await listJournalEntries());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/journal", async (req, res) => {
  try {
    res.json(await saveJournalEntry(req.body));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/journal/:id", async (req, res) => {
  try {
    res.json(await deleteJournalEntry(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/api/attachments/context", async (req, res) => {
  try {
    const attachment = await createContextAttachment(req.body ?? {});
    await createMemory({
      category: "attachment_context",
      content: `${attachment.title}: ${attachment.content}`,
      symbol: attachment.symbol,
      source: "attachment",
      pinned: false
    });
    res.status(201).json(attachment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── Market Data ───────────────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  if (!stockSymbols.has(symbol)) {
    res.status(400).json({ error: "Quote snapshots are configured for U.S. stock symbols only" });
    return;
  }

  const provider = configuredMarketDataProviderOrNull();
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
  const token = envValue("MASSIVE_API_KEY", "POLYGON_API_KEY");

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  if (!token) {
    res.json([]);
    return;
  }

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
  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  const resolution = String(req.query.resolution ?? "D");
  const provider = configuredMarketDataProviderOrNull();

  try {
    const candles = provider === "alpaca" ? await fetchAlpacaCandles(symbol, resolution) : provider === "massive" ? await fetchMassiveCandles(symbol, resolution) : await fetchStooqCandles(symbol, resolution);
    if (!candles.length) {
      res.status(502).json({ error: `${provider === "alpaca" ? "Alpaca" : provider === "massive" ? "Massive" : "Stooq"} did not return candle data` });
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
  const config = requireAiKey(res);
  if (!config) return;

  const { symbol = "NVDA", quote, candles = [], news = [] } = req.body ?? {};
  try {
    const content = await askModel([
      {
        role: "system",
        content: "You are QuantCore, an investment and market intelligence partner inside a portfolio research terminal. Be concise, risk-aware, and never guarantee future prices. Prioritize long-term thesis, valuation risk, catalysts, portfolio impact, then trading levels when useful."
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
    res.json({ model: aiConfig().model, content });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  const config = requireAiKey(res);
  if (!config) return;

  const { symbol = "NVDA", prompt = "", quote, candles = [], news = [], messages = [], portfolio = [], chatMode = "Long-Term Investor" } = req.body ?? {};
  if (!String(prompt).trim()) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }

  // 2. Intelligent Gatekeeper: Be strict on first message, trust the conversation after that.
  const hasHistory = messages && messages.length > 0;
  if (!hasHistory && !isMarketRelated(prompt)) {
    return res.json({ 
      model: "gatekeeper", 
      content: "I am a Quantitative Market Analyst. I only discuss stocks, markets, and financial data. Please provide a market-related query to initialize this research cluster." 
    });
  }

  // 2. Strict Asset Lock Check
  const mentionedTickers = prompt.match(/\$[A-Z]{1,5}/g) || [];
  const otherTickers = mentionedTickers.filter(t => t.replace("$", "").toUpperCase() !== symbol.toUpperCase());
  
  if (otherTickers.length > 0) {
    res.json({
      model: "QuantGatekeeper-V1",
      content: `STRICT LOCK ERROR: This research cluster is exclusively dedicated to $${symbol}. To analyze ${otherTickers.join(", ")}, please initialize a new Analysis Cluster in the sidebar.`,
      type: "asset_lock_blocked"
    });
    return;
  }

  try {
    // 2. Perform Similarity Search (Local RAG)
    const localContext = await searchIndex(prompt, 3);
    const contextStrings = localContext
      .filter((c) => !c.metadata?.symbol || c.metadata.symbol === symbol || c.metadata.symbol === "GLOBAL")
      .map(c => `[Past Context]: ${c.text}`)
      .join("\n");
    const memoryContext = await retrieveMemoryContext({ prompt, symbol });

    // 3. Optional Web Search for current events
    let webContextStrings = "";
    const searchKeywords = /latest|now|today|current|news|why|happening|recent|analysis|forecast|trend|what|how|earnings|report|sec|filing/i;
    const needsWebSearch = searchKeywords.test(prompt);
    let agentActivity = [];
    
    const systemPrompt = `You are QuantCore, the user's persistent Investment Intelligence Partner.
    Your mission is to provide institutional-grade investment and market briefing for $${symbol}.
    You remember who the user is, their investing style, portfolio preferences, trading rules, and saved thesis context through the MEMORY block.

    PROTOCOL:
    1. INVESTMENT FIRST: Default to long-term thesis, valuation/risk, catalysts, portfolio impact. Add trading levels only when relevant.
    2. PROFESSIONAL PARTNER: Acknowledge greetings briefly but do not linger on small talk.
    3. TELEGRAPHIC SIGNAL: Avoid filler. Use compact data strings, bullets, and high-impact phrases.
    4. MISSION FOCUSED: If the user asks a follow-up, answer ONLY that question with zero fluff.
    5. MODE AWARE: Respect chatMode. If mode is Portfolio Brain, analyze portfolio allocation and thesis risk. If mode is Earnings Review, focus on catalysts and thesis changes. If mode is Buy More / Hold / Trim, produce decision criteria.
    6. STRUCTURE:
       - THESIS: Long-term read
       - CATALYSTS: Market-moving news only
       - RISK: What can break the thesis
       - LEVELS: Critical support/resistance when useful
       - VERDICT: One-word bias (BULLISH/BEARISH/NEUTRAL)
    7. NO MARKDOWN: Never use "**". Use ALL CAPS headers.`;

    if (needsWebSearch) {
      agentActivity.push(`[SEARCHING] Latest news for ${symbol}...`);
      const webResults = await searchWeb(`${symbol} ${prompt}`);
      webContextStrings = webResults.map(r => `[Web Source]: ${r.title} - ${r.snippet}`).slice(0, 5).join("\n");
      agentActivity.push(`[RETRIEVED] ${webResults.length} web sources.`);
    }

    // 4. Construct Augmented Prompt
    const augmentedMessages = [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: JSON.stringify({
          query: prompt,
          selectedSymbol: symbol,
          currentQuote: quote,
          chatMode,
          portfolioContext: Array.isArray(portfolio) ? portfolio.slice(0, 20) : [],
          marketNews: news.slice(0, 5),
          durableMemory: memoryContext.text,
          localMemory: contextStrings,
          webResearch: webContextStrings,
          priorMessages: messages.slice(-5)
        })
      }
    ];

    const content = await askModel(augmentedMessages);
    
    // 5. Async: Persist chat and extract durable user/investment memory.
    const savedMemory = await recordChatInteraction({ symbol, prompt, response: content }).catch((error) => {
      console.error("Memory persistence failed:", error);
      return [];
    });

    res.json({ 
      model: aiConfig().model, 
      content,
      activity: agentActivity,
      sources: needsWebSearch ? "web" : "local",
      memoryUsed: memoryContext.used,
      memorySaved: savedMemory.map((item) => item.id)
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(502).json({ error: error.message });
  }
});

// ─── Server ────────────────────────────────────────────────────────────────────
const port = Number(process.env.API_PORT ?? 8787);

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

try {
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`QuantJournal API listening on port ${port}`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}
