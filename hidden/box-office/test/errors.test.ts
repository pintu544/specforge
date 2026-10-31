import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../src/errors.js";

test("HttpError sets name, status, and message", () => {
  const err = new HttpError(404, "Not found");

  assert.equal(err.name, "HttpError");
  assert.equal(err.status, 404);
  assert.equal(err.message, "Not found");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof HttpError);
});

test("HttpError preserves the provided status value exactly", () => {
  const status = 418;
  const err = new HttpError(status, "I'm a teapot");

  assert.equal(err.status, status);
});

test("HttpError can be thrown and caught as an Error", () => {
  const thrown = new HttpError(500, "Boom");

  try {
    throw thrown;
  } catch (caught) {
    assert.ok(caught instanceof Error);
    assert.ok(caught instanceof HttpError);
    assert.equal((caught as HttpError).status, 500);
    assert.equal((caught as Error).message, "Boom");
  }
});
