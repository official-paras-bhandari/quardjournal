import type { Candle, ChatMessage, Holding, JournalEntry, NewsItem, StrategyRule, SymbolKey, WatchSymbol } from "./types";

type Context = {
  selected: WatchSymbol;
  journal: JournalEntry[];
  strategies: StrategyRule[];
  holdings: Holding[];
  news: NewsItem[];
};

export function answerFromContext(question: string, context: Context): ChatMessage {
  const text = question.toLowerCase();
  const selectedJournal = context.journal.filter((entry) => entry.symbol === context.selected.symbol);
  const selectedNews = context.news.filter((item) => item.symbol === context.selected.symbol || item.symbol === "MARKET");
  const selectedHolding = context.holdings.find((holding) => holding.symbol === context.selected.symbol);

  if (/(guarantee|will it|next price|exact target|predict)/.test(text)) {
    return assistantMessage(
      "I cannot guarantee or predict future prices. Based only on the app data, I can summarize current context, journal history, risk, news impact, and scenarios to watch."
    );
  }

  if (/(journal|mistake|review|trade)/.test(text)) {
    if (!selectedJournal.length) {
      return assistantMessage(`I do not have any journal entries for ${context.selected.symbol} yet. Add a trade or investment note first, then I can review it.`);
    }
    const pnl = selectedJournal.reduce((sum, entry) => sum + entry.pnl, 0);
    return assistantMessage(
      `${context.selected.symbol} has ${selectedJournal.length} journal entry${selectedJournal.length > 1 ? "ies" : "y"} with total recorded PnL of ${formatCurrency(pnl)}. The main thesis on file is: "${selectedJournal[0].thesis}" Keep the review grounded in whether price still respects that thesis and whether risk stayed within the planned size.`
    );
  }

  if (/(news|alert|headline)/.test(text)) {
    const highImpact = selectedNews.filter((item) => item.impact === "high");
    const lead = highImpact[0] ?? selectedNews[0];
    if (!lead) return assistantMessage("I do not have news loaded for this symbol. I will not invent headlines.");
    return assistantMessage(
      `The most relevant loaded headline is "${lead.headline}" from ${lead.source}. Impact is marked ${lead.impact}. The alert center should treat high-impact symbol news as review-worthy, not as an automatic buy or sell signal.`
    );
  }

  if (/(portfolio|holding|allocation|share)/.test(text)) {
    if (!selectedHolding) {
      return assistantMessage(`${context.selected.symbol} is not currently in the saved portfolio. I can only discuss holdings that exist in the app state.`);
    }
    const value = selectedHolding.shares * context.selected.last;
    return assistantMessage(
      `${context.selected.symbol} position value is ${formatCurrency(value)} from ${selectedHolding.shares} shares at the loaded last price. Average cost is ${formatCurrency(selectedHolding.averageCost)}.`
    );
  }

  if (/(strategy|setup|entry|exit)/.test(text)) {
    const active = context.strategies.find((strategy) => strategy.status === "active") ?? context.strategies[0];
    return assistantMessage(
      `The active strategy on file is "${active.name}" on ${active.timeframe}. Entry rule: ${active.entry} Exit rule: ${active.exit} Risk is capped at ${active.riskPercent}% per idea.`
    );
  }

  return assistantMessage(
    `${context.selected.symbol} is loaded at ${formatCurrency(context.selected.last)} with a ${context.selected.changePercent.toFixed(2)}% move. I can answer from loaded watchlist, journal, strategy, news, and portfolio data. I will say when the app does not have enough data.`
  );
}

function assistantMessage(content: string): ChatMessage {
  return { id: crypto.randomUUID(), role: "assistant", content };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function knownSymbolsFromPrompt(prompt: string): SymbolKey[] {
  return ["NVDA", "AAPL", "TSLA", "MSFT", "AMD", "ETHUSD", "EURUSD"].filter((symbol) => prompt.toUpperCase().includes(symbol)) as SymbolKey[];
}

type AiMarketContext = {
  symbol: SymbolKey;
  quote?: Partial<WatchSymbol>;
  candles: Candle[];
  news: NewsItem[];
};

async function postAi<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
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
  return postAi<{ model: string; content: string }>("/api/ai/chat", context);
}
