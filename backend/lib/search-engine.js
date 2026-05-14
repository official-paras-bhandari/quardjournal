import googleIt from "google-it";

export async function searchWeb(query) {
  // Enforce domain constraint: add stock-related keywords if not present
  const stockKeywords = ["stock", "market", "trading", "investing", "price", "earnings"];
  const hasKeyword = stockKeywords.some(kw => query.toLowerCase().includes(kw));
  
  let finalizedQuery = query;
  if (!hasKeyword) {
    finalizedQuery = `${query} stock market analysis`;
  }

  try {
    const results = await googleIt({ query: finalizedQuery, "no-display": true, limit: 10 });
    return results.map(r => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet
    }));
  } catch (error) {
    console.error("Web search failed:", error);
    return [];
  }
}
