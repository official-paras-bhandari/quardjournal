import { LocalIndex } from "vectra";
import { pipeline } from "@xenova/transformers";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let extractor = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

export async function getEmbeddings(text) {
  const extract = await getExtractor();
  const output = await extract(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

const DATA_PATH = path.join(__dirname, "..", "data");
const INDEX_PATH = path.join(DATA_PATH, "vector_index");

export async function initIndex() {
  await fs.mkdir(DATA_PATH, { recursive: true });
  const index = new LocalIndex(INDEX_PATH);
  if (!(await index.isIndexCreated())) {
    await index.createIndex();
  }
  return index;
}

export async function addToIndex(text, metadata) {
  const index = await initIndex();
  const vector = await getEmbeddings(text);
  await index.insertItem({
    vector,
    metadata: { ...metadata, text }
  });
}

export async function searchIndex(query, limit = 5) {
  const index = await initIndex();
  const vector = await getEmbeddings(query);
  const results = await index.queryItems(vector, limit);
  return results.map(r => ({
    score: r.score,
    text: r.item.metadata.text,
    metadata: r.item.metadata
  }));
}
