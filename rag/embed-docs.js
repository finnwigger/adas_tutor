import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Document } from "@langchain/core/documents";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config();

const DOCS_PATH    = "rag/docs";
const STORAGE_PATH = "rag/storage";

const CHUNK_SIZE    = parseInt(process.env.RAG_CHUNK_SIZE    ?? "1000");
const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP ?? "200");

const fallbackSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

// Splits Markdown docs at "##" section headers; "###" sub-headers stay within
// their parent section. Oversized sections fall back to character splitting.
async function splitByMarkdownSection(doc) {
  const lines = doc.pageContent.split("\n");
  const title = lines[0]?.startsWith("# ") ? lines[0].slice(2).trim() : null;

  const sections = [];
  let current = null;
  for (const line of lines.slice(title ? 1 : 0)) {
    const heading = line.match(/^##\s+(.*)/);
    if (heading) {
      current = { heading: heading[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const chunks = [];
  for (const section of sections) {
    const body = section.lines.join("\n").trim();
    const text = title ? `${title} — ${section.heading}\n\n${body}` : `${section.heading}\n\n${body}`;
    const metadata = { ...doc.metadata, title, section: section.heading };

    if (text.length <= CHUNK_SIZE) {
      chunks.push(new Document({ pageContent: text, metadata }));
    } else {
      for (const part of await fallbackSplitter.splitText(text)) {
        chunks.push(new Document({ pageContent: part, metadata }));
      }
    }
  }

  return chunks.length ? chunks : fallbackSplitter.splitDocuments([doc]);
}

async function run() {
  console.log("Loading documents...");
  const loader = new DirectoryLoader(DOCS_PATH, {
    ".txt": (filePath) => new TextLoader(filePath),
    ".pdf": (filePath) => new PDFLoader(filePath),
    ".md":  (filePath) => new TextLoader(filePath),
  });

  const docs = await loader.load();
  console.log(`Loaded ${docs.length} document(s).`);

  for (const doc of docs) {
    if (doc.metadata?.source) {
      doc.metadata.source = path.basename(doc.metadata.source);
    }
  }

  console.log(`Splitting into chunks (by "##" section, falling back to size=${CHUNK_SIZE}/overlap=${CHUNK_OVERLAP} for oversized sections or non-Markdown docs)...`);
  const splitDocs = (await Promise.all(docs.map(splitByMarkdownSection))).flat();
  console.log(`Created ${splitDocs.length} chunks.`);

  console.log("Creating embeddings and saving vector store...");
  const vectorStore = await HNSWLib.fromDocuments(
    splitDocs,
    new GoogleGenerativeAIEmbeddings({ model: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001" })
  );

  await vectorStore.save(STORAGE_PATH);
  console.log("Embedding complete.");
}

run().catch((err) => {
  console.error("Embedding failed:", err);
  process.exit(1);
});
