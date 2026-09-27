import Anthropic from '@anthropic-ai/sdk';
import type { Intent, IntentProvider } from '@dutoan/core';
import { parseCommand } from '@dutoan/core';

/**
 * Optional LLM intent provider (enabled only when ANTHROPIC_API_KEY is set).
 * Claude maps the Vietnamese request to one of the same typed tools used by the
 * rule-based provider; the AssistantEngine then resolves ambiguities, asks
 * questions and previews the action before anything is applied.
 */
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'searchNorm',
    description: 'Search the norm library (định mức) by code or Vietnamese name.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'addItem',
    description:
      'Add a work item to the estimate. Provide normCode if the user gave a code, otherwise normQuery with the work description (e.g. "bê tông cột mác 300"). quantity in the unit the user said; unit like m3, m2, tan. categoryName is the hạng mục name if mentioned.',
    input_schema: {
      type: 'object',
      properties: {
        normCode: { type: 'string' },
        normQuery: { type: 'string' },
        quantity: { type: 'number' },
        quantityFormula: { type: 'string', description: 'Arithmetic formula such as 2*3.5*0.3' },
        unit: { type: 'string' },
        categoryName: { type: 'string' },
      },
    },
  },
  {
    name: 'updateQuantity',
    description: 'Change the quantity of an existing estimate line identified by line number, norm code or name.',
    input_schema: {
      type: 'object',
      properties: {
        line: { type: 'integer' },
        normCode: { type: 'string' },
        query: { type: 'string' },
        quantity: { type: 'number' },
        quantityFormula: { type: 'string' },
      },
    },
  },
  {
    name: 'setPrice',
    description: 'Set the project price of a material, labour or machine resource. priceUnit is the unit the price was quoted per (e.g. "tan" for đ/tấn).',
    input_schema: {
      type: 'object',
      properties: {
        resourceCode: { type: 'string' },
        resourceQuery: { type: 'string' },
        price: { type: 'number', description: 'Price in VND' },
        priceUnit: { type: 'string' },
      },
    },
  },
  {
    name: 'createCategory',
    description: 'Create a new category (hạng mục).',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  { name: 'recalc', description: 'Recalculate the estimate.', input_schema: { type: 'object', properties: {} } },
  { name: 'exportExcel', description: 'Export the estimate workbook to Excel.', input_schema: { type: 'object', properties: {} } },
  { name: 'importFile', description: 'Open the data import panel.', input_schema: { type: 'object', properties: {} } },
];

const SYSTEM = `You are the command interpreter of a Vietnamese construction cost-estimating application (dự toán xây dựng).
The user writes requests in Vietnamese, with or without diacritics. Map each request to exactly one tool call.
Only fill parameters the user actually stated; leave the rest out so the application can ask follow-up questions.
Vietnamese numbers use "." for thousands and "," for decimals (1.650.000 = 1650000; 2,5 = 2.5).
If the request is not about the estimate, reply briefly without calling a tool.`;

export class ClaudeProvider implements IntentProvider {
  readonly name = 'claude';
  private client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async parse(text: string): Promise<Intent> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM,
        tools: TOOLS,
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: text }],
      });
      if (response.stop_reason === 'refusal') return parseCommand(text);
      const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!call) return parseCommand(text);
      return { kind: call.name, ...(call.input as object) } as Intent;
    } catch (err) {
      if (err instanceof Anthropic.APIError) console.warn(`[assistant] Claude API error ${err.status}: ${err.message}`);
      else console.warn('[assistant] Claude provider failed:', err);
      // Fall back to the offline parser so the assistant keeps working.
      return parseCommand(text);
    }
  }
}
