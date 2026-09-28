/** Structured intents produced by an IntentProvider (rule-based or LLM). */
export type Intent =
  | {
      kind: 'addItem';
      normCode?: string;
      normQuery?: string;
      quantity?: number;
      quantityFormula?: string;
      unit?: string;
      categoryId?: number;
      categoryName?: string;
      /** User chose to create the category if it does not exist. */
      createCategory?: boolean;
    }
  | { kind: 'searchNorm'; query: string }
  | {
      kind: 'setPrice';
      resourceCode?: string;
      resourceQuery?: string;
      price?: number;
      /** Unit the price was given in (e.g. "tan" for "đ/tấn"). */
      priceUnit?: string;
    }
  | {
      kind: 'updateQuantity';
      itemId?: number;
      line?: number;
      normCode?: string;
      query?: string;
      quantity?: number;
      quantityFormula?: string;
    }
  | { kind: 'createCategory'; name?: string }
  /** Gắn mã định mức tự động cho các công việc chưa có mã (threshold 0–1). */
  | { kind: 'autoAssign'; threshold?: number }
  | { kind: 'recalc' }
  | { kind: 'exportExcel' }
  | { kind: 'importFile' }
  /** Mở hộp thoại "Cập nhật định mức & đơn giá theo khu vực". */
  | { kind: 'regionalUpdate' }
  | { kind: 'undo' }
  | { kind: 'help' }
  | { kind: 'unknown'; text: string };

export type IntentKind = Intent['kind'];

/** Typed tool calls. Every mutating action is previewed and applied only after confirmation. */
export type Action =
  | {
      tool: 'addItem';
      params: {
        categoryId?: number;
        newCategoryName?: string;
        normCode: string;
        quantity: number;
        quantityFormula?: string;
      };
    }
  | { tool: 'updateQuantity'; params: { itemId: number; quantity: number; quantityFormula?: string } }
  | { tool: 'setPrice'; params: { resourceCode: string; price: number } }
  | { tool: 'createCategory'; params: { name: string } }
  | { tool: 'autoAssignCodes'; params: { assignments: { itemId: number; normCode: string; confidence: number }[] } };

export interface ReplyOption {
  label: string;
  intent: Intent;
}

export type Reply =
  | { type: 'message'; text: string; options?: ReplyOption[]; table?: { columns: string[]; rows: (string | number)[][] } }
  | {
      type: 'question';
      text: string;
      options: ReplyOption[];
      /** When set, the next free-text answer fills this field of the intent. */
      pending?: { intent: Intent; field: 'quantity' | 'price' | 'categoryName' | 'name' | 'normQuery' };
    }
  | { type: 'preview'; text: string; action: Action }
  /** Non-mutating commands executed by the client/server directly (recalc, export, import, undo). */
  | { type: 'command'; text: string; command: 'recalc' | 'exportExcel' | 'importFile' | 'regionalUpdate' | 'undo' };

/** Pluggable intent source: rule-based parser (offline) or an LLM with tool calling. */
export interface IntentProvider {
  readonly name: string;
  parse(text: string): Promise<Intent>;
}
