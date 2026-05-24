import type { McpTestClient, McpToolSpec } from '../mcp-client';

const LM_STUDIO_BASE = `http://${process.env.LM_STUDIO_HOST ?? '192.168.253.143'}:${process.env.LM_STUDIO_PORT ?? '1234'}/v1`;
const EVAL_MODEL = process.env.EVAL_MODEL ?? 'qwen3.6-35b-a3b';
const MAX_TURNS = 10;

type Role = 'system' | 'user' | 'assistant' | 'tool';
interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface ScenarioResult {
  id: string;
  pass: boolean;
  toolCallTrace: string[];
  finalResponse: string;
  judgeReasoning: string;
  turnsUsed: number;
  error?: string;
}

// Prepended to every scenario conversation to keep responses focused and fast.
// /no_think suppresses Qwen3 extended reasoning (chain-of-thought) which can
// add hundreds of tokens without improving tool-calling accuracy for these evals.
const SYSTEM_PROMPT = 'You are an assistant with access to Autotask tools. Be concise and use tools directly. /no_think';

async function chatCompletion(
  messages: Message[],
  tools?: OpenAITool[],
): Promise<{ message: Message; finishReason: string }> {
  const allMessages: Message[] = tools
    ? [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
    : messages;
  const body: Record<string, unknown> = { model: EVAL_MODEL, messages: allMessages };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${LM_STUDIO_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: Message; finish_reason: string }>;
  };
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`LM Studio returned no choices`);
  return { message: choice.message, finishReason: choice.finish_reason };
}

function mcpToOpenAITools(tools: McpToolSpec[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    },
  }));
}

export async function runScenario(
  client: McpTestClient,
  scenario: { id: string; question: string; successDefinition: string },
): Promise<ScenarioResult> {
  const tools = mcpToOpenAITools(client.availableTools);
  const messages: Message[] = [{ role: 'user', content: scenario.question }];
  const toolCallTrace: string[] = [];
  let turnsUsed = 0;
  let finalResponse = '';

  try {
    while (turnsUsed < MAX_TURNS) {
      turnsUsed++;
      const { message, finishReason } = await chatCompletion(messages, tools);
      messages.push(message);

      if (finishReason === 'tool_calls' && message.tool_calls?.length) {
        for (const call of message.tool_calls) {
          const toolName = call.function.name;
          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(call.function.arguments) as Record<string, unknown>;
          } catch {
            toolArgs = {};
          }

          const argsSummary = JSON.stringify(toolArgs).slice(0, 150);
          toolCallTrace.push(`${toolName}(${argsSummary})`);

          let result: unknown;
          try {
            result = await client.callTool(toolName, toolArgs);
          } catch (callErr) {
            result = { error: true, summary: `Tool call failed: ${String(callErr).slice(0, 300)}` };
          }
          const resultSummary = JSON.stringify(result).slice(0, 600);
          toolCallTrace.push(`  -> ${resultSummary}`);

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: toolName,
            content: JSON.stringify(result),
          });
        }
      } else {
        finalResponse = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        break;
      }
    }

    if (!finalResponse) {
      return {
        id: scenario.id,
        pass: false,
        toolCallTrace,
        finalResponse: '',
        judgeReasoning: 'Max turns exceeded without producing a final response',
        turnsUsed,
        error: 'MAX_TURNS',
      };
    }

    // Judge: use same model with no tools
    const judgePrompt = `Evaluate whether the AI assistant interaction below meets the success criteria.

SUCCESS CRITERIA:
${scenario.successDefinition}

TOOL CALLS MADE:
${toolCallTrace.length ? toolCallTrace.join('\n') : '(none)'}

FINAL RESPONSE:
${finalResponse.slice(0, 2000)}

Reply PASS or FAIL on the first line. Then 1-2 sentences explaining why.`;

    const { message: judgeMsg } = await chatCompletion([{ role: 'user', content: judgePrompt }]);
    const judgeText = typeof judgeMsg.content === 'string' ? judgeMsg.content : '';
    const pass = /^PASS\b/i.test(judgeText.trim());

    return {
      id: scenario.id,
      pass,
      toolCallTrace,
      finalResponse,
      judgeReasoning: judgeText.slice(0, 600),
      turnsUsed,
    };
  } catch (err) {
    return {
      id: scenario.id,
      pass: false,
      toolCallTrace,
      finalResponse,
      judgeReasoning: '',
      turnsUsed,
      error: String(err),
    };
  }
}
