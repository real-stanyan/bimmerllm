// lib/pinecone.ts
import { Pinecone } from "@pinecone-database/pinecone";

let pc: Pinecone | null = null;

export function getPinecone() {
  if (!pc) {
    pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pc;
}

export function getBmwIndex() {
  const client = getPinecone();
  const index = client.index("bmw-qa");
  const ns = index.namespace("bmw_qa");
  return ns;
}
