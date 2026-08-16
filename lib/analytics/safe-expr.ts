/**
 * Safe arithmetic expressions over a whitelist of numeric variables.
 * Supports: + - * / ( ) unary-, numbers, identifiers, max/min/abs/coalesce.
 * Any missing/null variable yields null for the whole subexpression (except coalesce).
 */

export type ExprVars = Record<string, number | null | undefined>;

export type EvalExprResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FUNCS = new Set(["max", "min", "abs", "coalesce"]);

function tokenize(expr: string): Tok[] | { error: string } {
  const s = expr.trim();
  if (!s) return { error: "Empty expression" };
  if (s.length > 200) return { error: "Expression too long" };
  const tokens: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lp" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rp" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ t: "comma" });
      i += 1;
      continue;
    }
    if ("+-*/".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j += 1;
      const raw = s.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `Bad number: ${raw}` };
      tokens.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j += 1;
      const id = s.slice(i, j);
      tokens.push({ t: "id", v: id });
      i = j;
      continue;
    }
    return { error: `Unexpected character: ${ch}` };
  }
  return tokens;
}

/**
 * Recursive-descent parser/evaluator.
 * Grammar:
 *   expr   := term (("+"|"-") term)*
 *   term   := unary (("*"|"/") unary)*
 *   unary  := "-" unary | primary
 *   primary:= NUM | ID | FUNC "(" args ")" | "(" expr ")"
 */
function parseEval(
  tokens: Tok[],
  vars: ExprVars,
  allowedIds: Set<string>,
): EvalExprResult {
  let pos = 0;

  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

  function expr(): { value: number | null } | { error: string } {
    let left = term();
    if ("error" in left) return left;
    while (true) {
      const tk = peek();
      if (tk?.t !== "op" || (tk.v !== "+" && tk.v !== "-")) break;
      take();
      const right = term();
      if ("error" in right) return right;
      if (left.value == null || right.value == null) left = { value: null };
      else left = { value: tk.v === "+" ? left.value + right.value : left.value - right.value };
    }
    return left;
  }

  function term(): { value: number | null } | { error: string } {
    let left = unary();
    if ("error" in left) return left;
    while (true) {
      const tk = peek();
      if (tk?.t !== "op" || (tk.v !== "*" && tk.v !== "/")) break;
      take();
      const right = unary();
      if ("error" in right) return right;
      if (left.value == null || right.value == null) {
        left = { value: null };
      } else if (tk.v === "*") {
        left = { value: left.value * right.value };
      } else if (right.value === 0) {
        left = { value: null }; // divide by zero → null
      } else {
        left = { value: left.value / right.value };
      }
    }
    return left;
  }

  function unary(): { value: number | null } | { error: string } {
    const tk = peek();
    if (tk?.t === "op" && tk.v === "-") {
      take();
      const inner = unary();
      if ("error" in inner) return inner;
      return { value: inner.value == null ? null : -inner.value };
    }
    if (tk?.t === "op" && tk.v === "+") {
      take();
      return unary();
    }
    return primary();
  }

  function primary(): { value: number | null } | { error: string } {
    const tk = peek();
    if (!tk) return { error: "Unexpected end of expression" };
    if (tk.t === "num") {
      take();
      return { value: tk.v };
    }
    if (tk.t === "id") {
      take();
      if (peek()?.t === "lp") {
        if (!FUNCS.has(tk.v)) return { error: `Unknown function: ${tk.v}` };
        take(); // (
        const args: (number | null)[] = [];
        if (peek()?.t !== "rp") {
          while (true) {
            const a = expr();
            if ("error" in a) return a;
            args.push(a.value);
            if (peek()?.t === "comma") {
              take();
              continue;
            }
            break;
          }
        }
        if (peek()?.t !== "rp") return { error: "Expected )" };
        take();
        return { value: callFunc(tk.v, args) };
      }
      if (!IDENT.test(tk.v) || !allowedIds.has(tk.v)) {
        return { error: `Unknown variable: ${tk.v}` };
      }
      const raw = vars[tk.v];
      if (raw == null || !Number.isFinite(raw)) return { value: null };
      return { value: raw };
    }
    if (tk.t === "lp") {
      take();
      const inner = expr();
      if ("error" in inner) return inner;
      if (peek()?.t !== "rp") return { error: "Expected )" };
      take();
      return inner;
    }
    return { error: "Expected number, variable, or (" };
  }

  const result = expr();
  if ("error" in result) return { ok: false, error: result.error };
  if (pos !== tokens.length) return { ok: false, error: "Trailing tokens" };
  return {
    ok: true,
    value: result.value == null || !Number.isFinite(result.value) ? null : result.value,
  };
}

function callFunc(name: string, args: (number | null)[]): number | null {
  if (name === "abs") {
    if (args.length !== 1) return null;
    return args[0] == null ? null : Math.abs(args[0]);
  }
  if (name === "max" || name === "min") {
    const nums = args.filter((a): a is number => a != null && Number.isFinite(a));
    if (nums.length === 0) return null;
    return name === "max" ? Math.max(...nums) : Math.min(...nums);
  }
  if (name === "coalesce") {
    for (const a of args) {
      if (a != null && Number.isFinite(a)) return a;
    }
    return null;
  }
  return null;
}

export function evalSafeExpr(
  expr: string,
  vars: ExprVars,
  allowedIds: readonly string[],
): EvalExprResult {
  const tokens = tokenize(expr);
  if ("error" in tokens) return { ok: false, error: tokens.error };
  return parseEval(tokens, vars, new Set(allowedIds));
}

export function roundExpr(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}
