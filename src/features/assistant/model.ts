/**
 * Answering with a language model: the model picks tools, VAULT runs them
 * locally and hands back the results, and the model phrases the answer.
 * The loop is capped, and every tool call is kept so the answer stays
 * traceable.
 */

import type { Answer } from "./builtin";
import { TOOLS, runTool, type ToolCall, type ToolContext } from "./tools";

export interface ModelReply {
  content: string;
  tool_calls: { name: string; arguments: unknown }[];
}

/** One round with the model. Injected so the loop can be tested without one. */
export type Chat = (messages: unknown[], tools: unknown[]) => Promise<ModelReply>;

const MAX_ROUNDS = 5;

export const TOOL_SCHEMAS = TOOLS.map((tool) => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

export function systemPrompt(today: string): string {
  return [
    "You are the assistant inside VAULT, a private personal finance application. Amounts are in Moroccan dirhams (MAD).",
    `Today is ${today}.`,
    "Rules you must follow:",
    "1. Every figure in your answer must come from a tool result. Call tools to get figures; never calculate, estimate or recall them yourself.",
    "2. Quote amounts exactly as the tools return them.",
    "3. If the tools cannot answer the question, say so plainly instead of guessing.",
    "4. Explain and suggest; you are not a certified financial advisor, and the user decides.",
    "5. Be brief: a few sentences, plain language.",
  ].join("\n");
}

export async function askModel(question: string, context: ToolContext, chat: Chat): Promise<Answer> {
  const messages: unknown[] = [
    { role: "system", content: systemPrompt(context.today) },
    { role: "user", content: question },
  ];
  const calls: ToolCall[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await chat(messages, TOOL_SCHEMAS);
    if (reply.tool_calls.length === 0) {
      return { text: reply.content.trim() || "The model returned an empty answer.", calls };
    }
    messages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })),
    });
    for (const request of reply.tool_calls) {
      const args = request.arguments && typeof request.arguments === "object" ? (request.arguments as Record<string, unknown>) : {};
      const call = runTool(context, request.name, args);
      calls.push(call);
      messages.push({ role: "tool", tool_name: request.name, content: JSON.stringify(call.result) });
    }
  }
  return { text: "The model kept asking for more calculations without reaching an answer. Try the built-in answers, or rephrase the question.", calls };
}
