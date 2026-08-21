import crypto from "node:crypto";
import type { OpenRouterChatMessage } from "./openrouter";

type JsonRecord = Record<string, unknown>;

type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type AnthropicNormalizedResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<JsonRecord>;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numericValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function blocks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [{ type: "text", text: value }];
  return [];
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  const parts: string[] = [];
  for (const raw of blocks(value)) {
    const block = record(raw);
    const type = stringValue(block.type);
    if (type === "text" || type === "thinking") {
      const text = stringValue(block.text || block.thinking);
      if (text) parts.push(text);
      continue;
    }
    if (type === "tool_result") {
      const content = block.content;
      const text = typeof content === "string" ? content : textFromContent(content);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function openAIUserPart(raw: unknown): JsonRecord | null {
  const block = record(raw);
  const type = stringValue(block.type);
  if (type === "text") {
    const text = stringValue(block.text);
    return text ? { type: "text", text } : null;
  }
  if (type === "image") {
    const source = record(block.source);
    const sourceType = stringValue(source.type);
    if (sourceType === "base64") {
      const mediaType = stringValue(source.media_type) || "image/png";
      const data = stringValue(source.data);
      if (data) return { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } };
    }
    if (sourceType === "url") {
      const url = stringValue(source.url);
      if (url) return { type: "image_url", image_url: { url } };
    }
  }
  return null;
}

function toolResultText(block: JsonRecord): string {
  const content = block.content;
  if (typeof content === "string") return content;
  const text = textFromContent(content);
  if (text) return text;
  try { return JSON.stringify(content ?? ""); }
  catch { return String(content ?? ""); }
}

export function anthropicRequestToBrainMessages(body: JsonRecord): OpenRouterChatMessage[] {
  const result: OpenRouterChatMessage[] = [];
  for (const raw of Array.isArray(body.messages) ? body.messages : []) {
    const message = record(raw);
    const role = stringValue(message.role);
    if (role !== "user" && role !== "assistant") continue;
    const content = textFromContent(message.content);
    if (content.trim()) result.push({ role, content });
  }
  if (!result.some((message) => message.role === "user")) {
    const system = textFromContent(body.system);
    result.push({ role: "user", content: system || "Sophenic Code task" });
  }
  return result;
}

export function anthropicToOpenAIChat(body: JsonRecord, model: string): JsonRecord {
  const messages: OpenAIMessage[] = [];
  const topLevelSystem = textFromContent(body.system);
  if (topLevelSystem) messages.push({ role: "system", content: topLevelSystem });

  for (const raw of Array.isArray(body.messages) ? body.messages : []) {
    const message = record(raw);
    const role = stringValue(message.role);
    const content = message.content;

    if (role === "system") {
      const text = textFromContent(content);
      if (text) messages.push({ role: "system", content: text });
      continue;
    }

    if (role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];
      for (const rawBlock of blocks(content)) {
        const block = record(rawBlock);
        const type = stringValue(block.type);
        if (type === "text") {
          const text = stringValue(block.text);
          if (text) textParts.push(text);
        } else if (type === "tool_use") {
          const name = stringValue(block.name);
          if (!name) continue;
          const id = stringValue(block.id) || `toolu_${crypto.randomUUID().replace(/-/g, "")}`;
          let args = "{}";
          try { args = JSON.stringify(record(block.input)); } catch { /* keep {} */ }
          toolCalls.push({ id, type: "function", function: { name, arguments: args } });
        }
      }
      if (textParts.length || toolCalls.length) {
        messages.push({ role: "assistant", content: textParts.join("\n") || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      }
      continue;
    }

    if (role === "user") {
      const userParts: JsonRecord[] = [];
      const flushUser = () => {
        if (!userParts.length) return;
        messages.push({ role: "user", content: userParts.length === 1 && userParts[0].type === "text" ? userParts[0].text : [...userParts] });
        userParts.splice(0, userParts.length);
      };
      for (const rawBlock of blocks(content)) {
        const block = record(rawBlock);
        if (stringValue(block.type) === "tool_result") {
          flushUser();
          const toolCallId = stringValue(block.tool_use_id);
          if (toolCallId) messages.push({ role: "tool", tool_call_id: toolCallId, content: toolResultText(block) });
          continue;
        }
        const part = openAIUserPart(rawBlock);
        if (part) userParts.push(part);
      }
      flushUser();
    }
  }

  const tools = (Array.isArray(body.tools) ? body.tools : []).map((raw) => {
    const tool = record(raw);
    const name = stringValue(tool.name);
    if (!name) return null;
    return {
      type: "function",
      function: {
        name,
        description: stringValue(tool.description),
        parameters: record(tool.input_schema)
      }
    };
  }).filter(Boolean);

  const request: JsonRecord = {
    model,
    messages,
    max_tokens: numericValue(body.max_tokens) || 4096,
    stream: false
  };
  if (tools.length) request.tools = tools;
  const toolChoice = record(body.tool_choice);
  const choiceType = stringValue(toolChoice.type);
  if (choiceType === "auto") request.tool_choice = "auto";
  else if (choiceType === "any") request.tool_choice = "required";
  else if (choiceType === "none") request.tool_choice = "none";
  else if (choiceType === "tool" && stringValue(toolChoice.name)) request.tool_choice = { type: "function", function: { name: stringValue(toolChoice.name) } };
  if (typeof body.temperature === "number") request.temperature = body.temperature;
  if (typeof body.top_p === "number") request.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) request.stop = body.stop_sequences.filter((item): item is string => typeof item === "string");
  return request;
}

function parseToolArguments(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  const text = stringValue(value);
  if (!text) return {};
  try { return record(JSON.parse(text)); }
  catch { return { value: text }; }
}

export function openAIToAnthropic(payload: unknown, visibleModel: string): AnthropicNormalizedResponse {
  const root = record(payload);
  const choice = record(Array.isArray(root.choices) ? root.choices[0] : undefined);
  const message = record(choice.message);
  const content: Array<JsonRecord> = [];
  const text = stringValue(message.content);
  if (text) content.push({ type: "text", text });
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const raw of toolCalls) {
    const call = record(raw);
    const fn = record(call.function);
    const name = stringValue(fn.name);
    if (!name) continue;
    content.push({
      type: "tool_use",
      id: stringValue(call.id) || `toolu_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      input: parseToolArguments(fn.arguments)
    });
  }
  if (!content.length) content.push({ type: "text", text: "" });

  const usage = record(root.usage);
  const finishReason = stringValue(choice.finish_reason);
  const stopReason: AnthropicNormalizedResponse["stop_reason"] = toolCalls.length
    ? "tool_use"
    : finishReason === "length" || finishReason === "max_tokens"
      ? "max_tokens"
      : "end_turn";

  return {
    id: stringValue(root.id) || `msg_${crypto.randomUUID().replace(/-/g, "")}`,
    type: "message",
    role: "assistant",
    model: visibleModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: numericValue(usage.prompt_tokens ?? usage.input_tokens),
      output_tokens: numericValue(usage.completion_tokens ?? usage.output_tokens)
    }
  };
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function anthropicResponseToSse(response: AnthropicNormalizedResponse): string {
  const parts: string[] = [];
  parts.push(sseEvent("message_start", {
    type: "message_start",
    message: { ...response, content: [], stop_reason: null, usage: { input_tokens: response.usage.input_tokens, output_tokens: 0 } }
  }));

  response.content.forEach((block, index) => {
    const type = stringValue(block.type);
    if (type === "tool_use") {
      parts.push(sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} }
      }));
      let partial = "{}";
      try { partial = JSON.stringify(record(block.input)); } catch { /* keep {} */ }
      parts.push(sseEvent("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partial } }));
    } else {
      parts.push(sseEvent("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }));
      parts.push(sseEvent("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: stringValue(block.text) } }));
    }
    parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
  });

  parts.push(sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: response.stop_reason, stop_sequence: null },
    usage: { output_tokens: response.usage.output_tokens }
  }));
  parts.push(sseEvent("message_stop", { type: "message_stop" }));
  return parts.join("");
}

export function estimateAnthropicInputTokens(body: JsonRecord): number {
  const serialized = JSON.stringify({ system: body.system ?? "", messages: body.messages ?? [], tools: body.tools ?? [] });
  return Math.max(1, Math.ceil(serialized.length / 4));
}
