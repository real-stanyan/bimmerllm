// lib/ai/pinecone.ts
import { Pinecone } from "@pinecone-database/pinecone";

let _client: Pinecone | null = null;
export function pinecone() {
  if (!_client) _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _client;
}

export const BIMMERPOST_INDEX = "bmw-datas";
export const BIMMERPOST_NAMESPACE = "bimmerpost";

export function bimmerpostNamespace() {
  return pinecone().index(BIMMERPOST_INDEX).namespace(BIMMERPOST_NAMESPACE);
}
