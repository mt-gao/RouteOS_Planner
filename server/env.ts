import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config();

const envSchema = z.object({
  AMAP_KEY: z.string().min(1, "AMAP_KEY is required"),
  AMAP_JS_KEY: z.string().optional(),
  AMAP_SECURITY_JS_CODE: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  DEEPSEEK_REASONING_EFFORT: z.enum(["high", "max"]).optional(),
  MODEL_API_KEY: z.string().optional(),
  MODEL_BASE_URL: z.string().url().optional(),
  MODEL_NAME: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(5174)
});

export const env = envSchema.parse({
  AMAP_KEY: process.env.AMAP_KEY,
  AMAP_JS_KEY: process.env.AMAP_JS_KEY,
  AMAP_SECURITY_JS_CODE: process.env.AMAP_SECURITY_JS_CODE,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPSEEK_REASONING_EFFORT: process.env.DEEPSEEK_REASONING_EFFORT,
  MODEL_API_KEY: process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  MODEL_BASE_URL: process.env.MODEL_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com",
  MODEL_NAME: process.env.MODEL_NAME || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-v4-flash",
  PORT: process.env.PORT
});
