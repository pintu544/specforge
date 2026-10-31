import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import {
  HttpError,
  isHttpError,
  readJsonBody,
  sendJson,
  sendError,
} from "../src/http.js";

test("HttpError sets name, statusCode, and preserves message", () => {
  const error = new HttpError(418, "teapot");

  assert.equal(error.name, "HttpError");
  assert.equal(error.statusCode, 418);
  assert.equal(error.message, "teapot");
  assert.equal(isHttpError(error), true);
});

test("isHttpError only accepts branded HttpError instances from this module", () => {
  assert.equal(isHttpError(new Error("nope")), false);
  assert.equal(isHttpError({ statusCode: 400, message: "Invalid JSON" }), false);

  const foreignLike = new HttpError(400, "Invalid JSON");
  Object.defineProperty(foreignLike, Symbol("HttpErrorBrand"), {
    value: true,
  });
  assert.equal(isHttpError(foreignLike), true);
});

test("readJsonBody returns undefined for empty or whitespace-only bodies", async () => {
  const empty = Readable.from([]);
  const whitespace = Readable.from(["  \n\t  "]);

  await assert.doesNotReject(async () => {
    assert.equal(await readJsonBody(empty as any), undefined);
    assert.equal(await readJsonBody(whitespace as any), undefined);
  });
});

test("readJsonBody parses valid JSON from the request body", async () => {
  const request = Readable.from(['{"ok":true,"items":[1,2,3]}']);

  const body = await readJsonBody(request as any);
  assert.deepEqual(body, { ok: true, items: [1, 2, 3] });
});

test("readJsonBody accepts string chunks and combines them as UTF-8", async () => {
  const request = Readable.from(['{"msg":"', 'hello', '"}']);

  const body = await readJsonBody(request as any);
  assert.deepEqual(body, { msg: "hello" });
});

test("readJsonBody throws HttpError 400 Invalid JSON for malformed JSON", async () => {
  const request = Readable.from(["{"]);

  await assert.rejects(readJsonBody(request as any), (error: unknown) => {
    assert.equal(isHttpError(error), true);
    assert.equal((error as HttpError).statusCode, 400);
    assert.equal((error as Error).message, "Invalid JSON");
    return true;
  });
});

test("readJsonBody throws HttpError 400 Invalid JSON when the request stream errors", async () => {
  const request = new EventEmitter() as any;
  request[Symbol.asyncIterator] = async function* () {
    yield Buffer.from('{"x":1}');
    throw new Error("stream failure");
  };

  await assert.rejects(readJsonBody(request), (error: unknown) => {
    assert.equal(isHttpError(error), true);
    assert.equal((error as HttpError).statusCode, 400);
    assert.equal((error as Error).message, "Invalid JSON");
    return true;
  });
});

function makeResponse() {
  const headers = new Map<string, string>();
  const response: any = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    endCalledWith: undefined as unknown,
    end(chunk?: unknown) {
      this.endCalledWith = chunk;
    },
  };
  return response;
}

test("sendJson sets status, content-type, stringifies the body, and ends the response", () => {
  const response = makeResponse();

  sendJson(response, 201, { hello: "world" });

  assert.equal(response.statusCode, 201);
  assert.equal(response.getHeader("content-type"), "application/json; charset=utf-8");
  assert.equal(response.endCalledWith, JSON.stringify({ hello: "world" }));
});

test("sendJson serializes nullish bodies as null", () => {
  const response = makeResponse();

  sendJson(response, 204, undefined);

  assert.equal(response.endCalledWith, "null");
});

test("sendError sends the structured error payload through sendJson", () => {
  const response = makeResponse();

  sendError(response, 404, "Not found");

  assert.equal(response.statusCode, 404);
  assert.equal(response.getHeader("content-type"), "application/json; charset=utf-8");
  assert.equal(response.endCalledWith, JSON.stringify({ error: "Not found" }));
});
