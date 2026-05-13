import cors from "cors";
import express from "express";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "shares.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio_shares (
    id TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const massiveBaseUrl = process.env.MASSIVE_BASE_URL ?? "https://api.massive.com";
const massiveWsUrl = process.env.MASSIVE_WS_URL ?? "wss://delayed.massive.com/stocks";
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const deepseekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const stockSymbols = new Set(["NVDA", "AAPL", "TSLA", "MSFT", "AMD"]);
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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Massive returned ${response.status}`);
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

async function fetchMassiveCandles(symbol, resolution = "D", years = 1) {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(to.getFullYear() - years);
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/markets/quote", async (req, res) => {
  const token = requireMassiveKey(res);
  if (!token) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  if (!stockSymbols.has(symbol)) {
    res.status(400).json({ error: "Quote snapshots are currently configured for U.S. stock symbols only" });
    return;
  }

  try {
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
    try {
      res.json(await quoteFromLatestCandle(symbol));
    } catch (fallbackError) {
      res.status(502).json({ error: `${error.message}; fallback failed: ${fallbackError.message}` });
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
  const token = requireMassiveKey(res);
  if (!token) return;

  const symbol = String(req.query.symbol ?? "NVDA").toUpperCase();
  const resolution = String(req.query.resolution ?? "D");

  try {
    const candles = await fetchMassiveCandles(symbol, resolution);
    if (!candles.length) {
      res.status(502).json({ error: "Massive did not return candle data" });
      return;
    }
    res.json(candles);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/markets/stream", (req, res) => {
  const token = requireMassiveKey(res);
  if (!token) return;

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

  const upstream = new WebSocket(massiveWsUrl);
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25_000);

  upstream.addEventListener("open", () => {
    upstream.send(JSON.stringify({ action: "auth", params: token }));
  });

  upstream.addEventListener("message", (event) => {
    const messages = JSON.parse(String(event.data));
    const items = Array.isArray(messages) ? messages : [messages];
    for (const item of items) {
      if (item.status === "auth_success") {
        upstream.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol},T.${symbol},Q.${symbol}` }));
        res.write(`event: status\ndata: ${JSON.stringify({ status: "subscribed", symbol })}\n\n`);
        continue;
      }
      if (item.status === "error") {
        res.write(`event: error\ndata: ${JSON.stringify({ error: item.message ?? "Massive stream error" })}\n\n`);
        continue;
      }
      if (item.ev === "AM") {
        res.write(`event: candle\ndata: ${JSON.stringify({
          symbol: item.sym,
          time: Math.floor(item.e / 1000),
          open: item.o,
          high: item.h,
          low: item.l,
          close: item.c,
          volume: item.v ?? 0
        })}\n\n`);
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
    res.write(`event: error\ndata: ${JSON.stringify({ error: "Massive stream connection failed" })}\n\n`);
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

app.post("/api/ai/analyze", async (req, res) => {
  const token = requireDeepseekKey(res);
  if (!token) return;

  const { symbol = "NVDA", quote, candles = [], news = [] } = req.body ?? {};
  try {
    const content = await askDeepseek([
      {
        role: "system",
        content:
          "You are a market analysis assistant inside a trading journal. Be concise, risk-aware, and never guarantee future prices. Return practical analysis for education, not financial advice."
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
        content:
          "You are the AI analyst for a trading journal. Use only the supplied market context and conversation. If data is missing, say so. Do not provide certainty or personalized financial advice."
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

app.post("/api/share-portfolios", (req, res) => {
  const snapshot = req.body;
  if (!snapshot || !Array.isArray(snapshot.holdings)) {
    res.status(400).json({ error: "Invalid portfolio snapshot" });
    return;
  }

  const id = randomBytes(5).toString("hex");
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO portfolio_shares (id, snapshot, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify(snapshot), createdAt);
  res.status(201).json({ id, url: `/share/${id}` });
});

app.get("/api/share-portfolios/:id", (req, res) => {
  const row = db.prepare("SELECT snapshot FROM portfolio_shares WHERE id = ?").get(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  res.json(JSON.parse(row.snapshot));
});

const port = Number(process.env.API_PORT ?? 8787);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Share API listening on http://127.0.0.1:${port}`);
});
server.keepAliveTimeout = 65_000;
