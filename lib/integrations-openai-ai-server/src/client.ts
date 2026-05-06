import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL;

export const openai = new OpenAI({
  apiKey: apiKey || "not-configured",
  ...(baseURL ? { baseURL } : {}),
});
