import type { IncomingMessage, ServerResponse } from "node:http";

const httpErrorBrand = Symbol("HttpErrorBrand");

export class HttpError extends Error {
  readonly statusCode: number;
  [httpErrorBrand] = true;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError && (value as HttpError)[httpErrorBrand] === true;
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.trim().length === 0) {
      return undefined;
    }
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body ?? null));
}

export function sendError(response: ServerResponse, statusCode: number, message: string): void {
  sendJson(response, statusCode, { error: message });
}
