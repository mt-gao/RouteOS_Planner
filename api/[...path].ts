import type { IncomingMessage, ServerResponse } from "node:http";
import worker from "../worker/index";

type VercelRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
  url?: string;
};

type VercelResponse = ServerResponse & {
  status?: (code: number) => VercelResponse;
  json?: (body: unknown) => void;
};

const emptyAssets = {
  fetch: async () => new Response("Not found", { status: 404 })
};

function workerEnv() {
  const reasoningEffort: "high" | "max" | undefined =
    process.env.DEEPSEEK_REASONING_EFFORT === "high" || process.env.DEEPSEEK_REASONING_EFFORT === "max"
      ? process.env.DEEPSEEK_REASONING_EFFORT
      : undefined;
  return {
    ASSETS: emptyAssets,
    AMAP_KEY: process.env.AMAP_KEY,
    AMAP_JS_KEY: process.env.AMAP_JS_KEY,
    AMAP_SECURITY_JS_CODE: process.env.AMAP_SECURITY_JS_CODE,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    MODEL_BASE_URL: process.env.MODEL_BASE_URL,
    MODEL_NAME: process.env.MODEL_NAME,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_REASONING_EFFORT: reasoningEffort,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    RUNTIME_NAME: "vercel-function"
  };
}

function requestUrl(req: VercelRequest) {
  const host = req.headers.host || "localhost";
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${host}${req.url || "/"}`;
}

function requestHeaders(req: VercelRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function requestBody(req: VercelRequest) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body !== undefined) {
    if (typeof req.body === "string") return req.body;
    if (req.body instanceof Uint8Array) return Buffer.from(req.body).toString("utf8");
    return JSON.stringify(req.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

async function sendResponse(res: VercelResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end(await response.text());
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const request = new Request(requestUrl(req), {
      method: req.method,
      headers: requestHeaders(req),
      body: await requestBody(req)
    });
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        promise.catch((error) => console.error(error));
      }
    };
    const response = await worker.fetch(request, workerEnv(), ctx);
    await sendResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求处理失败";
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: message }));
  }
}
