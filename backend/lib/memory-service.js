import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { addToIndex, searchIndex } from "./vector-store.js";

const adapter = new PrismaBetterSqlite3({
  url: "file:./dev.db"
});
const prisma = new PrismaClient({ adapter });


const CORE_PERSONA = [
  {
    category: "assistant_persona",
    content: "Assistant identity: QuantCore Investment Intelligence Partner for a single-user QuantJournal terminal.",
    pinned: true
  },
  {
    category: "assistant_persona",
    content: "Default lens: investment research first, trading second. Cover thesis, valuation/risk, catalysts, portfolio impact, and technical levels only when useful.",
    pinned: true
  },
  {
    category: "assistant_persona",
    content: "Style: concise, professional, teammate-aware, high signal, no filler, no guaranteed predictions, no financial advice framing.",
    pinned: true
  }
];

// Initialize CORE_PERSONA if missing
async function initializeCorePersona() {
  const seeds = await prisma.aiMemory.findMany({ where: { source: "system_seed" } });
  if (seeds.length === 0) {
    for (const seed of CORE_PERSONA) {
      await prisma.aiMemory.create({
        data: {
          category: seed.category,
          content: seed.content,
          symbol: "GLOBAL",
          source: "system_seed",
          pinned: seed.pinned,
          enabled: true
        }
      });
    }
  }
}
initializeCorePersona().catch(console.error);

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function scopeMatches(item, symbol) {
  return !item.symbol || item.symbol === "GLOBAL" || item.symbol === symbol;
}

function categorizeMemory(text) {
  const value = text.toLowerCase();
  if (/who i am|i am|my name|i'm|identity|bro/.test(value)) return "identity";
  if (/long.?term|invest|portfolio|holding|valuation|compound|thesis|conviction|sector/.test(value)) return "investment_style";
  if (/trade|setup|entry|exit|stop|risk.?reward|scalp|swing/.test(value)) return "trading_style";
  if (/mistake|lesson|journal|review|emotion|discipline/.test(value)) return "journal_lesson";
  return "identity";
}

function shouldRemember(text) {
  return /(remember|my style|i prefer|i like|i am|i'm|who i am|long.?term|investment|investing|portfolio|risk|thesis|conviction|goal|lesson|mistake|strategy|trading style|as well|aswell)/i.test(text);
}

export async function listMemories({ symbol, includeDisabled = false } = {}) {
  const memories = await prisma.aiMemory.findMany({
    where: {
      ...(includeDisabled ? {} : { enabled: true }),
      ...(symbol ? { OR: [{ symbol }, { symbol: "GLOBAL" }] } : {})
    },
    orderBy: [
      { pinned: 'desc' },
      { updatedAt: 'desc' }
    ]
  });
  return memories;
}

export async function createMemory(input) {
  const content = normalizeText(input.content);
  if (!content) throw new Error("Memory content is required");

  const symbol = input.symbol ? String(input.symbol).toUpperCase() : "GLOBAL";
  const category = input.category ?? categorizeMemory(content);

  const duplicate = await prisma.aiMemory.findFirst({
    where: {
      enabled: true,
      category,
      symbol,
      content: { equals: content } // Note: case sensitive in sqlite usually, but good enough
    }
  });
  if (duplicate) return duplicate;

  const memory = await prisma.aiMemory.create({
    data: {
      category,
      content,
      symbol,
      source: input.source ?? "user_pinned",
      pinned: Boolean(input.pinned),
      enabled: input.enabled !== false
    }
  });

  await addToIndex(content, { type: "memory", memoryId: memory.id, category: memory.category, symbol: memory.symbol, timestamp: Date.now() }).catch(console.error);
  return memory;
}

export async function updateMemory(idValue, patch) {
  const item = await prisma.aiMemory.findUnique({ where: { id: idValue } });
  if (!item) throw new Error("Memory not found");
  
  const updatedData = { ...patch };
  if (patch.symbol) updatedData.symbol = String(patch.symbol).toUpperCase();
  if (patch.content) updatedData.content = normalizeText(patch.content);

  const updatedItem = await prisma.aiMemory.update({
    where: { id: idValue },
    data: updatedData
  });

  if (patch.content) {
    await addToIndex(updatedItem.content, { type: "memory", memoryId: updatedItem.id, category: updatedItem.category, symbol: updatedItem.symbol, timestamp: Date.now() }).catch(console.error);
  }
  return updatedItem;
}

export async function deleteMemory(idValue) {
  try {
    await prisma.aiMemory.delete({ where: { id: idValue } });
    return { deleted: true };
  } catch (err) {
    return { deleted: false };
  }
}

export async function createContextAttachment(input) {
  const content = normalizeText(input.content);
  if (!content) throw new Error("Attachment content is required");

  const attachment = await prisma.contextAttachment.create({
    data: {
      title: normalizeText(input.title) || "Research context",
      content,
      symbol: input.symbol ? String(input.symbol).toUpperCase() : "GLOBAL",
      scope: input.scope ?? (input.symbol ? "symbol" : "global")
    }
  });

  await addToIndex(content, { type: "attachment_context", attachmentId: attachment.id, symbol: attachment.symbol, timestamp: Date.now() }).catch(console.error);
  return attachment;
}

export async function retrieveMemoryContext({ prompt, symbol }) {
  const enabled = await prisma.aiMemory.findMany({ where: { enabled: true } });
  
  const direct = enabled.filter((item) => (
    item.pinned ||
    item.category === "assistant_persona" ||
    item.category === "identity" ||
    item.category === "investment_style" ||
    item.category === "trading_style" ||
    scopeMatches(item, symbol)
  ));

  const semantic = await searchIndex(prompt, 8).catch(() => []);
  const enabledMemoryIds = new Set(enabled.map((item) => item.id));
  const semanticMemories = semantic
    .filter((result) => ["memory", "attachment_context", "chat_history"].includes(result.metadata?.type))
    .filter((result) => scopeMatches(result.metadata ?? {}, symbol))
    .filter((result) => result.metadata?.type !== "memory" || enabledMemoryIds.has(result.metadata?.memoryId))
    .slice(0, 5);

  const memoryLines = direct.slice(0, 14).map((item) => `[${item.category}${item.symbol && item.symbol !== "GLOBAL" ? `:${item.symbol}` : ""}] ${item.content}`);
  const semanticLines = semanticMemories.map((item) => `[Retrieved ${item.metadata?.type}] ${item.text}`);
  return {
    text: [...new Set([...memoryLines, ...semanticLines])].join("\n"),
    used: [...direct.slice(0, 14).map((item) => item.id), ...semanticMemories.map((item) => item.metadata?.memoryId ?? item.metadata?.attachmentId).filter(Boolean)]
  };
}

export async function recordChatInteraction({ symbol, prompt, response }) {
  const chat = await prisma.chatInteraction.create({
    data: {
      symbol,
      prompt: normalizeText(prompt),
      response: normalizeText(response)
    }
  });

  await addToIndex(`User asked: ${chat.prompt}\nAI Response: ${chat.response}`, { symbol, type: "chat_history", timestamp: Date.now() }).catch(console.error);

  const saved = [];
  if (shouldRemember(chat.prompt)) {
    saved.push(await createMemory({
      category: categorizeMemory(chat.prompt),
      content: chat.prompt,
      symbol: /\$[A-Z]{1,6}/.test(chat.prompt) ? symbol : "GLOBAL",
      source: "chat_derived",
      pinned: false
    }));
  }
  return saved;
}

export async function listPortfolio() {
  return await prisma.portfolioHolding.findMany();
}

export async function savePortfolioItem(input) {
  const symbol = String(input.symbol).toUpperCase();
  
  const existing = input.id 
    ? await prisma.portfolioHolding.findUnique({ where: { id: input.id } }) 
    : await prisma.portfolioHolding.findFirst({ where: { symbol } });

  let item;
  if (existing) {
    item = await prisma.portfolioHolding.update({
      where: { id: existing.id },
      data: {
        shares: Number(input.shares ?? existing.shares),
        averageCost: Number(input.averageCost ?? existing.averageCost),
        conviction: input.conviction ?? existing.conviction,
        timeHorizon: input.timeHorizon ?? existing.timeHorizon,
        thesis: normalizeText(input.thesis ?? existing.thesis),
        invalidation: normalizeText(input.invalidation ?? existing.invalidation),
        riskNotes: normalizeText(input.riskNotes ?? existing.riskNotes)
      }
    });
  } else {
    item = await prisma.portfolioHolding.create({
      data: {
        symbol,
        shares: Number(input.shares ?? 0),
        averageCost: Number(input.averageCost ?? 0),
        conviction: input.conviction ?? "core",
        timeHorizon: input.timeHorizon ?? "long-term",
        thesis: normalizeText(input.thesis),
        invalidation: normalizeText(input.invalidation),
        riskNotes: normalizeText(input.riskNotes)
      }
    });
  }

  if (item.thesis) {
    await addToIndex(`Portfolio Thesis for ${item.symbol}: ${item.thesis}`, { 
      type: "portfolio_thesis", 
      symbol: item.symbol, 
      portfolioId: item.id,
      timestamp: Date.now() 
    }).catch(console.error);
  }

  return item;
}

export async function deletePortfolioItem(idValue) {
  try {
    // Attempt delete by ID
    await prisma.portfolioHolding.delete({ where: { id: idValue } });
    return { deleted: true };
  } catch (err) {
    try {
      // Attempt delete by symbol
      await prisma.portfolioHolding.deleteMany({ where: { symbol: idValue } });
      return { deleted: true };
    } catch {
      return { deleted: false };
    }
  }
}

// ─── Journal Management ──────────────────────────────────────────────
export async function listJournalEntries() {
  return await prisma.journalEntry.findMany({
    orderBy: { createdAt: 'desc' }
  });
}

export async function saveJournalEntry(input) {
  const existing = input.id ? await prisma.journalEntry.findUnique({ where: { id: input.id } }) : null;

  if (existing) {
    return await prisma.journalEntry.update({
      where: { id: existing.id },
      data: {
        timestamp: input.timestamp ?? existing.timestamp,
        ticker: input.ticker ?? existing.ticker,
        side: input.side ?? existing.side,
        price: input.price ?? existing.price,
        duration: input.duration ?? existing.duration,
        rr: input.rr ?? existing.rr,
        tag: input.tag ?? existing.tag,
        pnl: input.pnl ?? existing.pnl,
        notes: input.notes ?? existing.notes
      }
    });
  }

  return await prisma.journalEntry.create({
    data: {
      timestamp: input.timestamp ?? nowIso(),
      ticker: input.ticker ?? "UNKNOWN",
      side: input.side ?? "LONG",
      price: input.price ?? "0",
      duration: input.duration ?? "0",
      rr: input.rr ?? "0",
      tag: input.tag ?? "",
      pnl: input.pnl ?? "0",
      notes: input.notes ?? ""
    }
  });
}

export async function deleteJournalEntry(idValue) {
  try {
    await prisma.journalEntry.delete({ where: { id: idValue } });
    return { deleted: true };
  } catch (err) {
    return { deleted: false };
  }
}
