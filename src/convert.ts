/**
 * Conversion between pi's message/tool model and the Anthropic Messages API,
 * including Claude Code tool-name mapping used in OAuth (subscription) mode.
 */

import type {
	ContentBlockParam,
	ImageBlockParam,
	MessageParam,
	TextBlockParam,
	Tool as AnthropicTool,
	ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import type { ImageContent, Message, StopReason, TextContent, ThinkingContent, Tool } from "@earendil-works/pi-ai";
import { CLAUDE_CODE_TOOLS } from "./constants.ts";
import { sanitizeSurrogates } from "./prompt.ts";

const ccToolLookup = new Map(CLAUDE_CODE_TOOLS.map((name) => [name.toLowerCase(), name]));

/** Maps a pi tool name to its canonical Claude Code name (e.g. `bash` -> `Bash`). */
export function toClaudeCodeName(name: string): string {
	return ccToolLookup.get(name.toLowerCase()) ?? name;
}

/** Maps a Claude Code tool name back to the matching pi tool name. */
export function fromClaudeCodeName(name: string, tools?: Tool[]): string {
	const lower = name.toLowerCase();
	return tools?.find((t) => t.name.toLowerCase() === lower)?.name ?? name;
}

/** Converts pi text/image content into an Anthropic content payload. */
function convertContentBlocks(content: (TextContent | ImageContent)[]): string | (TextBlockParam | ImageBlockParam)[] {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks: (TextBlockParam | ImageBlockParam)[] = content.map((block) =>
		block.type === "text"
			? { type: "text", text: sanitizeSurrogates(block.text) }
			: { type: "image", source: { type: "base64", media_type: block.mimeType as never, data: block.data } },
	);

	if (!blocks.some((b) => b.type === "text")) {
		blocks.unshift({ type: "text", text: "(see attached image)" });
	}

	return blocks;
}

/** Converts pi's conversation history into Anthropic message params. */
export function convertMessages(messages: Message[], isOAuth: boolean): MessageParam[] {
	const params: MessageParam[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim()) {
					params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				}
			} else {
				const blocks = convertContentBlocks(msg.content);
				if (blocks.length > 0) {
					params.push({ role: "user", content: blocks });
				}
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			for (const block of msg.content) {
				if (block.type === "text" && block.text.trim()) {
					blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking" && block.thinking.trim()) {
					const signature = (block as ThinkingContent).thinkingSignature;
					if (signature) {
						blocks.push({ type: "thinking", thinking: sanitizeSurrogates(block.thinking), signature });
					} else {
						blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: isOAuth ? toClaudeCodeName(block.name) : block.name,
						input: block.arguments,
					});
				}
			}
			if (blocks.length > 0) {
				params.push({ role: "assistant", content: blocks });
			}
		} else if (msg.role === "toolResult") {
			// Coalesce consecutive tool results into a single user message.
			const toolResults: ToolResultBlockParam[] = [];
			let j = i;
			while (j < messages.length && messages[j].role === "toolResult") {
				const tr = messages[j] as Extract<Message, { role: "toolResult" }>;
				toolResults.push({
					type: "tool_result",
					tool_use_id: tr.toolCallId,
					content: convertContentBlocks(tr.content),
					is_error: tr.isError,
				});
				j++;
			}
			i = j - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	// Cache everything up to the final user turn.
	const last = params[params.length - 1];
	if (last?.role === "user" && Array.isArray(last.content)) {
		const lastBlock = last.content[last.content.length - 1] as { cache_control?: { type: "ephemeral" } };
		if (lastBlock) lastBlock.cache_control = { type: "ephemeral" };
	}

	return params;
}

/** Converts pi tools into Anthropic tool definitions, applying name mapping. */
export function convertTools(tools: Tool[], isOAuth: boolean): AnthropicTool[] {
	return tools.map((tool) => {
		const schema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
		return {
			name: isOAuth ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: schema.properties ?? {},
				required: schema.required ?? [],
			},
		};
	});
}

/** Maps an Anthropic stop reason to pi's StopReason enum. */
export function mapStopReason(reason: string | null | undefined): StopReason {
	switch (reason) {
		case "end_turn":
		case "pause_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		default:
			return "error";
	}
}
