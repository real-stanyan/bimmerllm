// lib/ai/google.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const aiSdkGoogle = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export const langchainGemini = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY!,
  temperature: 0.2,
});

export const GEMINI_MODEL_ID = "gemini-2.5-flash-lite";
