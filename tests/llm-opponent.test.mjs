import assert from "node:assert/strict";
import test from "node:test";
import { createLlmOpponent } from "../runtime/browser-llm.js";
import { handleRequest } from "../infra/llm-proxy/handler.mjs";

const observation = { player: 1, public: { turn: 1, players: [
  { graveyard: [], monsters: [], spells_traps: [], banished: [] },
  { graveyard: [], monsters: [], spells_traps: [], banished: [] }] }, own_hand: [123],
  own_face_down: [], own_extra: [],
  legal_actions: [{ id: "0", kind: "end_turn", label: "End turn", card_ids: [] },
    { id: "1", kind: "summon", label: "Summon", card_ids: [123] }] };
const event = (provider = "openai") => ({ requestContext: { http: { method: "POST" } },
  body: JSON.stringify({ provider, model: provider === "openai" ? "gpt-5.4-mini" : "claude-haiku-5-5",
    apiKey: "test-key-not-real", observation }) });

test("OpenAI relay sends a stateless structured request and accepts only legal IDs", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text",
      text: '{"action_id":"1"}' }] }] }) };
  };
  const result = await handleRequest(event(), fetchImpl);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { action_id: "1" });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(JSON.parse(request.options.body).store, false);
  assert.equal(JSON.parse(request.options.body).text.format.type, "json_schema");
  assert.equal(result.headers["cache-control"], "no-store");
});

test("Anthropic relay and invalid model choices", async () => {
  let request;
  const good = await handleRequest(event("anthropic"), async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ content: [{ type: "thinking", thinking: "private" }, { type: "text",
      text: '{"action_id":"0"}' }] }) };
  });
  assert.equal(good.statusCode, 200);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "test-key-not-real");
  assert.equal(request.options.headers["anthropic-version"], "2026-10-21");
  const anthropicBody = JSON.parse(request.options.body);
  assert.equal(anthropicBody.max_tokens, 1024);
  assert.equal(anthropicBody.output_config.effort, "low");
  assert.equal(anthropicBody.output_config.format.type, "json_schema");
  const illegal = await handleRequest(event(), async () => ({ ok: true, json: async () => ({
    output: [{ content: [{ type: "output_text", text: '{"action_id":"999"}' }] }],
  }) }));
  assert.equal(illegal.statusCode, 422);
});

test("truncated and empty Claude responses explain the failure", async () => {
  const truncated = await handleRequest(event("anthropic"), async () => ({
    ok: true, json: async () => ({ stop_reason: "max_tokens", content: [{ type: "thinking" }] }),
  }));
  assert.equal(truncated.statusCode, 502);
  assert.match(JSON.parse(truncated.body).error, /output tokens/);
  const empty = await handleRequest(event("anthropic"), async () => ({
    ok: true, json: async () => ({ stop_reason: "end_turn", content: [] }),
  }));
  assert.equal(empty.statusCode, 502);
  assert.match(JSON.parse(empty.body).error, /no choice text/);
});

test("relay rejects bad input and sanitizes provider errors", async () => {
  const invalid = await handleRequest({ ...event(), body: JSON.stringify({
    provider: "evil", model: "x", apiKey: "secret123", observation }) });
  assert.equal(invalid.statusCode, 400);
  const rejected = await handleRequest(event(), async () => ({ ok: false, status: 401 }));
  assert.equal(rejected.statusCode, 401);
  assert.doesNotMatch(rejected.body, /test-key-not-real/);
});

test("browser client sends the key only in the request and rejects illegal IDs", async () => {
  let request;
  const client = createLlmOpponent({ endpoint: "https://example.lambda-url.eu-west-1.on.aws/",
    provider: "openai", model: "gpt-5.4-mini", apiKey: "test-key-not-real",
    names: { 123: { name: "Test Monster" } },
    fetchImpl: async (url, options) => { request = { url, options }; return {
      ok: true, json: async () => ({ action_id: "1" }) }; } });
  assert.equal((await client.choose(observation)).id, "1");
  assert.equal(JSON.parse(request.options.body).apiKey, "test-key-not-real");
  assert.equal(JSON.parse(request.options.body).observation.card_names[123], "Test Monster");
  const bad = createLlmOpponent({ endpoint: "https://example.lambda-url.eu-west-1.on.aws/",
    provider: "openai", model: "gpt-5.4-mini", apiKey: "test-key-not-real",
    fetchImpl: async () => ({ ok: true, json: async () => ({ action_id: "999" }) }) });
  await assert.rejects(bad.choose(observation), /illegal action/);
});
