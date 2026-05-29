/**
 * Streaming implementation for the Claude Code provider.
 *
 * Bridges the Anthropic Messages streaming API to pi's AssistantMessageEventStream,
 * impersonating the Claude Code CLI when authenticated with an OAuth token.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	calculateCost,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import {
	CLAUDE_CODE_BETAS,
	COMMON_BETAS,
	DEFAULT_THINKING_BUDGETS,
	getClaudeCliUserAgent,
} from "./constants.ts";
import { convertMessages, convertTools, fromClaudeCodeName, mapStopReason } from "./convert.ts";
import { buildSystemBlocks } from "./prompt.ts";

/** A streamed Anthropic OAuth token starts with this prefix. */
function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

interface AnthropicUsageLike {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}

function applyUsage(model: Model<Api>, output: AssistantMessage, usage: AnthropicUsageLike): void {
	output.usage.input = usage.input_tokens ?? output.usage.input;
	output.usage.output = usage.output_tokens ?? output.usage.output;
	output.usage.cacheRead = usage.cache_read_input_tokens ?? output.usage.cacheRead;
	output.usage.cacheWrite = usage.cache_creation_input_tokens ?? output.usage.cacheWrite;
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

/** Internal block bookkeeping: track the streaming index and accumulated tool JSON. */
type StreamingBlock = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };

export function streamClaudeCode(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey ?? "";
			const isOAuth = isOAuthToken(apiKey);

			const anthropicBeta = isOAuth
				? [...CLAUDE_CODE_BETAS, ...COMMON_BETAS].join(",")
				: COMMON_BETAS.join(",");

			const clientOptions: ConstructorParameters<typeof Anthropic>[0] = {
				baseURL: model.baseUrl,
				dangerouslyAllowBrowser: true,
				defaultHeaders: {
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					"anthropic-beta": anthropicBeta,
				},
			};

			if (isOAuth) {
				clientOptions.apiKey = null;
				clientOptions.authToken = apiKey;
				Object.assign(clientOptions.defaultHeaders as Record<string, string>, {
					"user-agent": await getClaudeCliUserAgent(),
					"x-app": "cli",
				});
			} else {
				clientOptions.apiKey = apiKey;
			}

			const client = new Anthropic(clientOptions);

			const params: MessageCreateParamsStreaming = {
				model: model.id,
				messages: convertMessages(context.messages, isOAuth),
				max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
				stream: true,
			};

			const system = buildSystemBlocks(context.systemPrompt, isOAuth);
			if (system) params.system = system;

			if (context.tools?.length) {
				params.tools = convertTools(context.tools, isOAuth);
			}

			if (options?.reasoning && model.reasoning) {
				const customBudget = options.thinkingBudgets?.[options.reasoning as keyof typeof options.thinkingBudgets];
				params.thinking = {
					type: "enabled",
					budget_tokens: customBudget ?? DEFAULT_THINKING_BUDGETS[options.reasoning] ?? 10240,
				};
			}

			const anthropicStream = client.messages.stream({ ...params }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			const blocks = output.content as StreamingBlock[];
			const indexOf = (eventIndex: number) => blocks.findIndex((b) => b.index === eventIndex);

			for await (const event of anthropicStream) {
				if (event.type === "message_start") {
					applyUsage(model, output, event.message.usage);
				} else if (event.type === "content_block_start") {
					const cb = event.content_block;
					if (cb.type === "text") {
						blocks.push({ type: "text", text: "", index: event.index } as StreamingBlock);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (cb.type === "thinking") {
						blocks.push({ type: "thinking", thinking: "", thinkingSignature: "", index: event.index } as StreamingBlock);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (cb.type === "tool_use") {
						blocks.push({
							type: "toolCall",
							id: cb.id,
							name: isOAuth ? fromClaudeCodeName(cb.name, context.tools) : cb.name,
							arguments: {},
							partialJson: "",
							index: event.index,
						} as StreamingBlock);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
				} else if (event.type === "content_block_delta") {
					const index = indexOf(event.index);
					const block = blocks[index];
					if (!block) continue;

					if (event.delta.type === "text_delta" && block.type === "text") {
						block.text += event.delta.text;
						stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
					} else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
						block.thinking += event.delta.thinking;
						stream.push({ type: "thinking_delta", contentIndex: index, delta: event.delta.thinking, partial: output });
					} else if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
						block.partialJson += event.delta.partial_json;
						try {
							block.arguments = JSON.parse(block.partialJson);
						} catch {}
						stream.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta.partial_json, partial: output });
					} else if (event.delta.type === "signature_delta" && block.type === "thinking") {
						block.thinkingSignature = (block.thinkingSignature ?? "") + event.delta.signature;
					}
				} else if (event.type === "content_block_stop") {
					const index = indexOf(event.index);
					const block = blocks[index];
					if (!block) continue;

					delete (block as Partial<StreamingBlock>).index;
					if (block.type === "text") {
						stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
					} else if (block.type === "thinking") {
						stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
					} else if (block.type === "toolCall") {
						try {
							block.arguments = JSON.parse(block.partialJson);
						} catch {}
						delete (block as { partialJson?: string }).partialJson;
						stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
					}
				} else if (event.type === "message_delta") {
					if (event.delta.stop_reason) {
						output.stopReason = mapStopReason(event.delta.stop_reason);
					}
					applyUsage(model, output, event.usage);
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
