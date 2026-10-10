/**
 * Excel-style `when` expression parser + evaluator (doc 29/09 §3.11).
 * Mirrors backend-python/app/services/when_expression_parser.py — keep both
 * in lockstep; shared contract vectors live in when-expr.test.ts.
 *
 * Grammar: expr := funcCall | comparison | var
 *   funcCall   := NAME '(' expr (',' expr)* ')'
 *   comparison := operand OP operand
 *   operand    := {var} | literal
 *   OP         := = <> < <= > >=
 *   FUNCS      := AND | OR (>= 2 args) · NOT (1) · ISBLANK (1 var)
 */

import type { MemorySpaces } from './types';

export interface WhenEvalContext {
  reply: string | null;
  memory: MemorySpaces;
  manifestLists?: Record<string, Array<{ value: string; [k: string]: unknown }>>;
}

type Tok =
  | { k: 'var'; v: string }
  | { k: 'lit'; v: string }
  | { k: 'op'; v: string }
  | { k: 'func'; v: string }
  | { k: 'lp' | 'rp' | 'comma'; v: string };

const OPS = ['<=', '>=', '<>', '=', '<', '>'];

export function tokenizeWhen(text: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ k: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ k: 'rp', v: c }); i++; continue; }
    if (c === ',') { out.push({ k: 'comma', v: c }); i++; continue; }
    if (c === '{') {
      const end = text.indexOf('}', i);
      if (end === -1) return "unclosed '{'";
      out.push({ k: 'var', v: text.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (op) { out.push({ k: 'op', v: op }); i += op.length; continue; }
    let j = i;
    while (j < n && !/[\s,(){=<>]/.test(text[j])) j++;
    const word = text.slice(i, j);
    if (!word) return `unexpected character '${c}'`;
    let k = j;
    while (k < n && /\s/.test(text[k])) k++;
    if (k < n && text[k] === '(' && /^[A-Z]+$/.test(word)) out.push({ k: 'func', v: word });
    else out.push({ k: 'lit', v: word });
    i = j;
  }
  return out;
}

/** Resolve a `{ns.key}` variable against memory; undefined → blank. */
function resolveVar(name: string, ctx: WhenEvalContext): unknown {
  if (name === 'reply') return ctx.reply;
  const dot = name.indexOf('.');
  if (dot <= 0) return undefined;
  const space = name.slice(0, dot) as keyof MemorySpaces;
  const key = name.slice(dot + 1);
  const scope = ctx.memory[space] as Record<string, unknown> | undefined;
  return scope ? scope[key] : undefined;
}

function coerceLiteral(raw: string): unknown {
  if (raw === 'TRUE') return true;
  if (raw === 'FALSE') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/** HH:MM → minutes-of-day; duration suffixes h/m/d → seconds-ish number. */
function toComparable(v: unknown): number | string | boolean {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const dur = /^(\d+)(h|m|d)$/.exec(s);
  if (dur) {
    const mult = { h: 3600, m: 60, d: 86400 }[dur[2] as 'h' | 'm' | 'd'];
    return Number(dur[1]) * mult;
  }
  return s;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  // Blank operand with an ordering operator → FALSE (doc §3.11 keeps old rule).
  if ((a === undefined || b === undefined) && op !== '=' && op !== '<>') return false;
  const ca = toComparable(a === undefined ? null : a);
  const cb = toComparable(b === undefined ? null : b);
  switch (op) {
    case '=': return ca === cb;
    case '<>': return ca !== cb;
    case '<': return (ca as number) < (cb as number);
    case '<=': return (ca as number) <= (cb as number);
    case '>': return (ca as number) > (cb as number);
    case '>=': return (ca as number) >= (cb as number);
    default: return false;
  }
}

class Parser {
  pos = 0;
  private toks: Tok[];
  private ctx: WhenEvalContext;
  constructor(toks: Tok[], ctx: WhenEvalContext) {
    this.toks = toks;
    this.ctx = ctx;
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  evalExpr(): boolean {
    const tok = this.peek();
    if (!tok) return false;
    if (tok.k === 'func') return this.evalFunc();
    const left = this.evalOperand();
    const opTok = this.peek();
    if (opTok?.k === 'op') {
      this.next();
      const right = this.evalOperand();
      return compare(opTok.v, left, right);
    }
    // bare variable → truthy check
    return Boolean(left);
  }

  private evalOperand(): unknown {
    const tok = this.next();
    if (!tok) return undefined;
    if (tok.k === 'var') return resolveVar(tok.v, this.ctx);
    if (tok.k === 'lit') return coerceLiteral(tok.v);
    return undefined;
  }

  private evalFunc(): boolean {
    const name = (this.next() as { v: string }).v;
    this.next(); // consume '('
    const args: boolean[] = [];
    const argVars: string[] = [];
    while (true) {
      const t = this.peek();
      if (!t || t.k === 'rp') { this.next(); break; }
      if (args.length > 0) {
        if (t.k !== 'comma') break;
        this.next(); // consume comma
      }
      const cur = this.peek();
      if (!cur || cur.k === 'rp') { this.next(); break; }
      // For ISBLANK we need the raw var name, not its value.
      if (name === 'ISBLANK' && cur.k === 'var') {
        this.next();
        argVars.push(cur.v);
        args.push(false);
        continue;
      }
      // For INLIST we need the raw var names for both arguments.
      if (name === 'INLIST' && cur.k === 'var') {
        this.next();
        argVars.push(cur.v);
        args.push(false);
        continue;
      }
      args.push(this.evalExpr());
    }
    switch (name) {
      case 'AND': return args.every(Boolean);
      case 'OR': return args.some(Boolean);
      case 'NOT': return !args[0];
      case 'ISBLANK': return resolveVar(argVars[0] ?? '', this.ctx) === undefined;
      case 'INLIST': {
        if (argVars.length !== 2) return false;
        const [varName, listRef] = argVars;
        const match = /^lists\.([A-Za-z0-9_]+)\.value$/.exec(listRef);
        if (!match) return false;
        const listName = match[1];
        const rawVal = resolveVar(varName, this.ctx);
        if (rawVal === undefined || rawVal === null || rawVal === '') return false;
        const valStr = String(rawVal);
        const list = this.ctx.manifestLists?.[listName];
        if (!list || !Array.isArray(list)) {
          console.warn(`[when-expr] INLIST: list '${listName}' not found in manifest`);
          return false;
        }
        return list.some((item) => item && typeof item === 'object' && String(item.value) === valStr);
      }
      default: return false;
    }
  }
}

/**
 * Evaluate a `when` expression string. Returns false on parse errors (fail
 * closed — a broken branch never fires) and for `default` (handled by caller).
 */
export function evalWhen(expr: string, ctx: WhenEvalContext): boolean {
  const toks = tokenizeWhen(expr);
  if (typeof toks === 'string') return false; // tokenize error
  if (toks.length === 0) return false;
  // Paren balance — unclosed ')' fails closed (validator flags it too).
  let depth = 0;
  for (const t of toks) {
    if (t.k === 'lp') depth++;
    else if (t.k === 'rp') depth--;
    if (depth < 0) return false;
  }
  if (depth > 0) return false;
  try {
    return new Parser(toks, ctx).evalExpr();
  } catch {
    return false;
  }
}

/**
 * K7 reply normalization — lowercase, trim, strip trailing punctuation and
 * wrapping quotes. Applied to raw LLM output before comparing to option names.
 */
export function normalizeReply(raw: string): string {
  let s = (raw || '').trim().toLowerCase();
  s = s.replace(/^["'`«»“”]+|["'`«»“”]+$/g, '');
  s = s.replace(/[.!?。…]+$/g, '').trim();
  return s;
}
