import Groq from 'groq-sdk';
import { TOOL_SCHEMAS, executeTool } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Cache: query → result (TTL 5 min)
const cache = new Map<string, { result: AgentResult; ts: number }>();
const CACHE_TTL = 1 * 60 * 1000;

export interface AgentResult {
  answer: string;
  products: unknown[];
  stores: unknown[];
  tools_called: string[];
}

// Convert Anthropic-style tool schemas → OpenAI/Groq format
const GROQ_TOOLS: Groq.Chat.ChatCompletionTool[] = TOOL_SCHEMAS.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// Strip heavy fields before sending tool results back to the model
function slimOutput(toolName: string, output: unknown): unknown {
  if (toolName === 'search_products') {
    const o = output as any;
    return {
      total: o.total,
      products: (o.products ?? []).slice(0, 8).map((p: any) => ({
        id:        p.id,
        title:     p.title,
        price:     p.price,
        shop_name: p.shop_name,
        shop_location: p.shop_location,
      })),
    };
  }
  if (toolName === 'search_stores') {
    return (output as any[]).slice(0, 5).map((s: any) => ({
      shop_id:    s.shop_id,
      name:       s.name,
      location:   s.location,
      avg_rating: s.avg_rating,
    }));
  }
  return output;
}

export async function runSearchAgent(query: string): Promise<AgentResult> {
  const cacheKey = query.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: query },
  ];

  let allProducts: unknown[] = [];
  let allStores: unknown[] = [];
  const toolsCalled: string[] = [];

  for (let i = 0; i < 5; i++) {
    const response = await groq.chat.completions.create({
      model:      'llama-3.1-8b-instant',
      max_tokens: 512,
      tools:      GROQ_TOOLS,
      tool_choice: i === 0 ? 'required' : 'auto',
      messages,
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // No tool calls → final answer
      const answer = msg.content ?? '';
      const result: AgentResult = { answer, products: allProducts, stores: allStores, tools_called: toolsCalled };
      cache.set(cacheKey, { result, ts: Date.now() });
      return result;
    }

    // Execute each tool call
    for (const tc of msg.tool_calls) {
      toolsCalled.push(tc.function.name);
      let toolOutput: unknown;

      try {
        const input = JSON.parse(tc.function.arguments);
        toolOutput = await executeTool(tc.function.name, input);
        if (tc.function.name === 'search_products') allProducts = (toolOutput as any).products ?? [];
        if (tc.function.name === 'search_stores')   allStores   = toolOutput as any[];
      } catch (err: any) {
        toolOutput = { error: err.message };
      }

      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        content:      JSON.stringify(slimOutput(tc.function.name, toolOutput)),
      });
    }
  }

  return { answer: 'عذراً، لم أتمكن من معالجة طلبك.', products: [], stores: [], tools_called: toolsCalled };
}
