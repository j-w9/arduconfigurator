// The MAVExplorer graph expression language.
//
// A graph <expression> is a whitespace-separated list of series terms. Each
// term is a Python expression (MAVExplorer eval()s it against the latest
// message of every type) with optional suffixes, stripped in grapher.py order:
//   `expr<label>`  custom legend label
//   `expr:2`       plot on the second y axis (`:1` = first, the default)
//   `expr{cond}`   only plot a point while `cond` is true
// Fields are `MSG.Field`, instances `MSG[0].Field`, whole messages bare `MSG`
// (passed to functions), and function results can be vectors (`f(..).x`).
//
// This is a tokenizer + Pratt parser for the Python subset the graphs use,
// compiled to closures for evaluation. Nothing in the public API throws.

import { lookupFunction, MATH1 } from './functions.js'
import type { EvalEnv, MessageRecord, Value } from './types.js'

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '//' | '%' | '**'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&' | '|' | '^' | '<<' | '>>'
  | 'and' | 'or'

export type UnaryOp = '-' | '+' | '~' | 'not'

export type Node =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'str'; readonly value: string }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'attr'; readonly object: Node; readonly name: string }
  | { readonly kind: 'index'; readonly object: Node; readonly index: Node }
  | { readonly kind: 'call'; readonly callee: string; readonly args: readonly Node[] }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly operand: Node }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Node; readonly right: Node }

export interface ExpressionError {
  readonly message: string
  /** Character offset in `text` where the problem was found. */
  readonly position: number
  readonly text: string
}

export type ParseResult = { readonly ok: true; readonly ast: Node } | { readonly ok: false; readonly error: ExpressionError }

/** One series of a graph. */
export interface Term {
  /** The term as written, suffixes included. */
  readonly text: string
  /** Legend label: the custom `<label>`, or the term without its axis suffix. */
  readonly label: string
  readonly axis: 1 | 2
  readonly ast: Node
  /** The `{cond}` gate, when present. */
  readonly condition?: Node
}

export type TermResult = { readonly ok: true; readonly term: Term } | { readonly ok: false; readonly error: ExpressionError }

export interface Reference {
  readonly message: string
  readonly instance?: number
  readonly field?: string
}

// --- tokenizer ---------------------------------------------------------------

type TokenKind = 'num' | 'str' | 'name' | 'op' | 'end'
interface Token {
  kind: TokenKind
  text: string
  value?: number | string
  pos: number
}

const OPERATORS2 = ['**', '//', '==', '!=', '<=', '>=', '<<', '>>']
const OPERATORS1 = '+-*/%<>&|^~()[],.'

class ExpressionSyntaxError extends Error {
  constructor(message: string, readonly position: number) {
    super(message)
  }
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    const start = i
    const prev = tokens[tokens.length - 1]
    const afterOperand = prev !== undefined && (prev.kind !== 'op' || prev.text === ')' || prev.text === ']')
    if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1] ?? '') && !afterOperand)) {
      if (ch === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
        i += 2
        while (i < text.length && /[0-9a-fA-F]/.test(text[i])) i += 1
        tokens.push({ kind: 'num', text: text.slice(start, i), value: parseInt(text.slice(start + 2, i), 16), pos: start })
        continue
      }
      while (i < text.length && isDigit(text[i])) i += 1
      if (text[i] === '.') {
        i += 1
        while (i < text.length && isDigit(text[i])) i += 1
      }
      if (text[i] === 'e' || text[i] === 'E') {
        let j = i + 1
        if (text[j] === '+' || text[j] === '-') j += 1
        if (isDigit(text[j] ?? '')) {
          i = j
          while (i < text.length && isDigit(text[i])) i += 1
        }
      }
      const numText = text.slice(start, i)
      tokens.push({ kind: 'num', text: numText, value: Number(numText), pos: start })
      continue
    }
    if (isIdentStart(ch)) {
      while (i < text.length && (isIdentStart(text[i]) || isDigit(text[i]))) i += 1
      tokens.push({ kind: 'name', text: text.slice(start, i), pos: start })
      continue
    }
    if (ch === '"' || ch === "'") {
      i += 1
      let value = ''
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\' && i + 1 < text.length) i += 1
        value += text[i]
        i += 1
      }
      if (i >= text.length) throw new ExpressionSyntaxError('unterminated string', start)
      i += 1
      tokens.push({ kind: 'str', text: text.slice(start, i), value, pos: start })
      continue
    }
    const two = text.slice(i, i + 2)
    if (OPERATORS2.includes(two)) {
      tokens.push({ kind: 'op', text: two, pos: start })
      i += 2
      continue
    }
    if (OPERATORS1.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, pos: start })
      i += 1
      continue
    }
    throw new ExpressionSyntaxError(`unexpected character '${ch}'`, start)
  }
  tokens.push({ kind: 'end', text: '', pos: text.length })
  return tokens
}

// --- Pratt parser ------------------------------------------------------------

// Python precedence, loosest first. `**` binds tighter than unary minus on its
// left (-2**2 == -4) but accepts a unary operand on its right (2**-1).
const BP_OR = 1
const BP_AND = 2
const BP_NOT = 3
const BP_COMPARE = 4
const BP_UNARY = 11
const BP_POWER = 12
const BP_POSTFIX = 13

const INFIX_BP: Readonly<Record<string, number>> = {
  or: BP_OR,
  and: BP_AND,
  '==': BP_COMPARE, '!=': BP_COMPARE, '<': BP_COMPARE, '<=': BP_COMPARE, '>': BP_COMPARE, '>=': BP_COMPARE,
  '|': 5,
  '^': 6,
  '&': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '//': 10, '%': 10,
  '**': BP_POWER,
  '.': BP_POSTFIX, '[': BP_POSTFIX, '(': BP_POSTFIX
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]
  }

  private next(): Token {
    return this.tokens[this.index++]
  }

  private expect(text: string): Token {
    const token = this.next()
    if (token.kind !== 'op' || token.text !== text) {
      throw new ExpressionSyntaxError(`expected '${text}'${token.kind === 'end' ? ' before end' : ` but found '${token.text}'`}`, token.pos)
    }
    return token
  }

  parseAll(): Node {
    const node = this.parse(0)
    const token = this.peek()
    if (token.kind !== 'end') throw new ExpressionSyntaxError(`unexpected '${token.text}'`, token.pos)
    return node
  }

  private infixOp(token: Token): string | undefined {
    if (token.kind === 'op') return token.text
    if (token.kind === 'name' && (token.text === 'and' || token.text === 'or')) return token.text
    return undefined
  }

  private parse(minBp: number): Node {
    let left = this.prefix()
    for (;;) {
      const token = this.peek()
      const op = this.infixOp(token)
      const bp = op === undefined ? undefined : INFIX_BP[op]
      if (op === undefined || bp === undefined || bp <= minBp) break
      this.next()
      if (op === '.') {
        const name = this.next()
        if (name.kind !== 'name') throw new ExpressionSyntaxError('expected a field name after "."', name.pos)
        left = { kind: 'attr', object: left, name: name.text }
      } else if (op === '[') {
        const index = this.parse(0)
        this.expect(']')
        left = { kind: 'index', object: left, index }
      } else if (op === '(') {
        if (left.kind !== 'name') throw new ExpressionSyntaxError('only named functions can be called', token.pos)
        const args: Node[] = []
        if (!(this.peek().kind === 'op' && this.peek().text === ')')) {
          for (;;) {
            args.push(this.parse(0))
            if (this.peek().kind === 'op' && this.peek().text === ',') {
              this.next()
              continue
            }
            break
          }
        }
        this.expect(')')
        left = { kind: 'call', callee: left.name, args }
      } else if (op === '**') {
        left = { kind: 'binary', op: '**', left, right: this.parse(BP_UNARY) }
      } else {
        left = { kind: 'binary', op: op as BinaryOp, left, right: this.parse(bp) }
      }
    }
    return left
  }

  private prefix(): Node {
    const token = this.next()
    switch (token.kind) {
      case 'num':
        return { kind: 'num', value: token.value as number }
      case 'str':
        return { kind: 'str', value: token.value as string }
      case 'name':
        if (token.text === 'not') return { kind: 'unary', op: 'not', operand: this.parse(BP_NOT) }
        if (token.text === 'and' || token.text === 'or') break
        return { kind: 'name', name: token.text }
      case 'op':
        if (token.text === '(') {
          const inner = this.parse(0)
          this.expect(')')
          return inner
        }
        if (token.text === '-' || token.text === '+' || token.text === '~') {
          // Operand stops before * / but takes ** (Python: -a**b == -(a**b)).
          return { kind: 'unary', op: token.text, operand: this.parse(BP_UNARY - 1) }
        }
        break
      case 'end':
        throw new ExpressionSyntaxError('unexpected end of expression', token.pos)
    }
    throw new ExpressionSyntaxError(`unexpected '${token.text}'`, token.pos)
  }
}

/** Parse a bare Python expression (no term suffixes). */
export function parseFormula(text: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokenize(text)).parseAll() }
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      return { ok: false, error: { message: error.message, position: error.position, text } }
    }
    return { ok: false, error: { message: String(error), position: 0, text } }
  }
}

/** Parse one series term, with its `<label>`, `:2` / `:1` and `{cond}` suffixes. */
export function parseTerm(text: string): TermResult {
  let body = text.trim()
  let customLabel: string | undefined
  if (body.endsWith('>')) {
    const open = body.lastIndexOf('<')
    // A trailing `>` is a label only if what follows `<` is not part of a comparison.
    if (open > 0 && !/[<>=!]/.test(body[open - 1]) && !/^[=<]/.test(body.slice(open + 1))) {
      customLabel = body.slice(open + 1, -1)
      body = body.slice(0, open)
    }
  }
  let axis: 1 | 2 = 1
  if (body.endsWith(':2')) {
    axis = 2
    body = body.slice(0, -2)
  } else if (body.endsWith(':1')) {
    body = body.slice(0, -2)
  }
  const label = customLabel ?? body
  let condition: Node | undefined
  let formula = body
  if (body.endsWith('}')) {
    const open = body.lastIndexOf('{')
    if (open === -1) return { ok: false, error: { message: "unmatched '}'", position: body.length - 1, text } }
    const parsedCondition = parseFormula(body.slice(open + 1, -1))
    if (!parsedCondition.ok) {
      return { ok: false, error: { ...parsedCondition.error, position: parsedCondition.error.position + open + 1, text } }
    }
    condition = parsedCondition.ast
    formula = body.slice(0, open)
  }
  if (formula.trim() === '') return { ok: false, error: { message: 'empty expression', position: 0, text } }
  const parsed = parseFormula(formula)
  if (!parsed.ok) return { ok: false, error: { ...parsed.error, text } }
  return { ok: true, term: condition ? { text, label, axis, ast: parsed.ast, condition } : { text, label, axis, ast: parsed.ast } }
}

/** Split a graph expression into whitespace-separated terms and parse each. */
export function parseExpression(text: string): { terms: Term[]; errors: ExpressionError[] } {
  const terms: Term[] = []
  const errors: ExpressionError[] = []
  for (const part of text.split(/\s+/)) {
    if (!part) continue
    const result = parseTerm(part)
    if (result.ok) terms.push(result.term)
    else errors.push(result.error)
  }
  return { terms, errors }
}

// --- analysis ----------------------------------------------------------------

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
  ['tau', 2 * Math.PI],
  ['inf', Infinity],
  ['nan', NaN],
  ['True', 1],
  ['False', 0]
])

function isConstantName(name: string): boolean {
  return CONSTANTS.has(name) || name === 'None'
}

function literalInstance(node: Node): number | undefined {
  if (node.kind === 'num' && Number.isInteger(node.value)) return node.value
  if (node.kind === 'unary' && node.op === '-' && node.operand.kind === 'num') return -node.operand.value
  return undefined
}

function visit(node: Node, fn: (node: Node) => boolean): void {
  // `fn` returns false to stop descending into this node's children.
  if (!fn(node)) return
  switch (node.kind) {
    case 'attr':
      visit(node.object, fn)
      break
    case 'index':
      visit(node.object, fn)
      visit(node.index, fn)
      break
    case 'call':
      for (const arg of node.args) visit(arg, fn)
      break
    case 'unary':
      visit(node.operand, fn)
      break
    case 'binary':
      visit(node.left, fn)
      visit(node.right, fn)
      break
    default:
      break
  }
}

/** Message (and instance / field) references in an AST, deduplicated, in order. */
export function collectReferences(ast: Node): Reference[] {
  const out: Reference[] = []
  const seen = new Set<string>()
  const add = (ref: Reference) => {
    const key = `${ref.message}[${ref.instance ?? ''}].${ref.field ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ref)
  }
  visit(ast, (node) => {
    if (node.kind === 'name') {
      if (!isConstantName(node.name)) add({ message: node.name })
      return false
    }
    if (node.kind === 'index' && node.object.kind === 'name') {
      const instance = literalInstance(node.index)
      if (instance !== undefined && !isConstantName(node.object.name)) {
        add({ message: node.object.name, instance })
        return false
      }
    }
    if (node.kind === 'attr') {
      const target = node.object
      if (target.kind === 'name' && !isConstantName(target.name)) {
        add({ message: target.name, field: node.name })
        return false
      }
      if (target.kind === 'index' && target.object.kind === 'name') {
        const instance = literalInstance(target.index)
        if (instance !== undefined) {
          add({ message: target.object.name, instance, field: node.name })
          return false
        }
      }
    }
    return true
  })
  return out
}

/** Names of every function an AST calls, deduplicated. */
export function collectFunctions(ast: Node): string[] {
  const out = new Set<string>()
  visit(ast, (node) => {
    if (node.kind === 'call') out.add(node.callee)
    return true
  })
  return [...out]
}

/** References of a whole term (formula and condition). */
export function termReferences(term: Term): Reference[] {
  const refs = collectReferences(term.ast)
  if (!term.condition) return refs
  const seen = new Set(refs.map((r) => `${r.message}[${r.instance ?? ''}].${r.field ?? ''}`))
  for (const ref of collectReferences(term.condition)) {
    const key = `${ref.message}[${ref.instance ?? ''}].${ref.field ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

/** Functions of a whole term (formula and condition). */
export function termFunctions(term: Term): string[] {
  const names = new Set(collectFunctions(term.ast))
  if (term.condition) for (const name of collectFunctions(term.condition)) names.add(name)
  return [...names]
}

// --- evaluation --------------------------------------------------------------

/** A compiled expression: evaluates against an environment, never throws. */
export type CompiledExpression = (env: EvalEnv) => Value

function truthy(value: Value): boolean {
  if (value === undefined) return false
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function isObject(value: Value): value is MessageRecord {
  return typeof value === 'object' && value !== null
}

function pyMod(a: number, b: number): number | undefined {
  if (b === 0) return undefined
  const r = a % b
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r
}

function bitwise(op: BinaryOp, a: number, b: number): number | undefined {
  // Python bitwise operators only take integers.
  if (!Number.isInteger(a) || !Number.isInteger(b)) return undefined
  const x = BigInt(a)
  const y = BigInt(b)
  switch (op) {
    case '&': return Number(x & y)
    case '|': return Number(x | y)
    case '^': return Number(x ^ y)
    case '<<': return b < 0 ? undefined : Number(x << y)
    case '>>': return b < 0 ? undefined : Number(x >> y)
    default: return undefined
  }
}

function binary(op: BinaryOp, a: Value, b: Value): Value {
  if (typeof a === 'number' && typeof b === 'number') {
    switch (op) {
      case '+': return a + b
      case '-': return a - b
      case '*': return a * b
      case '/': return b === 0 ? undefined : a / b
      case '//': return b === 0 ? undefined : Math.floor(a / b)
      case '%': return pyMod(a, b)
      case '**': return a === 0 && b < 0 ? undefined : a ** b
      case '==': return a === b ? 1 : 0
      case '!=': return a !== b ? 1 : 0
      case '<': return a < b ? 1 : 0
      case '<=': return a <= b ? 1 : 0
      case '>': return a > b ? 1 : 0
      case '>=': return a >= b ? 1 : 0
      default: return bitwise(op, a, b)
    }
  }
  if (typeof a === 'string' && typeof b === 'string') {
    switch (op) {
      case '+': return a + b
      case '==': return a === b ? 1 : 0
      case '!=': return a !== b ? 1 : 0
      case '<': return a < b ? 1 : 0
      case '<=': return a <= b ? 1 : 0
      case '>': return a > b ? 1 : 0
      case '>=': return a >= b ? 1 : 0
      default: return undefined
    }
  }
  if (a !== undefined && b !== undefined) {
    if (op === '==') return a === b ? 1 : 0
    if (op === '!=') return a !== b ? 1 : 0
  }
  return undefined
}

function compileNode(node: Node): CompiledExpression {
  switch (node.kind) {
    case 'num': {
      const value = node.value
      return () => value
    }
    case 'str': {
      const value = node.value
      return () => value
    }
    case 'name': {
      const name = node.name
      const constant = CONSTANTS.get(name)
      if (constant !== undefined) return () => constant
      if (name === 'None') return () => undefined
      return (env) => env.message(name)
    }
    case 'attr': {
      const field = node.name
      const target = node.object
      // Fast paths for MSG.Field and MSG[k].Field — the bulk of every graph.
      let messageName: string | undefined
      let instance: number | undefined
      if (target.kind === 'name' && !isConstantName(target.name)) {
        messageName = target.name
      } else if (target.kind === 'index' && target.object.kind === 'name') {
        instance = literalInstance(target.index)
        if (instance !== undefined) messageName = target.object.name
      }
      if (messageName !== undefined) {
        const name = messageName
        const inst = instance
        if (field === '_timestamp') return (env) => (env.message(name, inst) ? env.timestamp?.(name, inst) : undefined)
        return (env) => {
          const record = env.message(name, inst)
          if (record === undefined) return undefined
          const value = record[field]
          return typeof value === 'function' ? undefined : (value as Value)
        }
      }
      const object = compileNode(target)
      return (env) => {
        const value = object(env)
        if (!isObject(value) || Array.isArray(value)) return undefined
        const out = (value as MessageRecord)[field]
        return typeof out === 'function' ? undefined : (out as Value)
      }
    }
    case 'index': {
      if (node.object.kind === 'name' && !isConstantName(node.object.name)) {
        const name = node.object.name
        const literal = literalInstance(node.index)
        if (literal !== undefined) return (env) => env.message(name, literal)
        const index = compileNode(node.index)
        return (env) => {
          const i = index(env)
          return typeof i === 'number' ? env.message(name, i) : undefined
        }
      }
      const object = compileNode(node.object)
      const index = compileNode(node.index)
      return (env) => {
        const value = object(env)
        const i = index(env)
        if (typeof i !== 'number' || !Number.isInteger(i)) return undefined
        if (Array.isArray(value) || typeof value === 'string') {
          const at = i < 0 ? value.length + i : i
          return value[at] as Value
        }
        return undefined
      }
    }
    case 'call': {
      const args = node.args.map(compileNode)
      const math1 = MATH1.get(node.callee)
      if (math1 && args.length === 1) {
        const arg = args[0]
        return (env) => {
          const x = arg(env)
          return typeof x === 'number' ? math1(x) : undefined
        }
      }
      const fn = lookupFunction(node.callee)
      if (!fn) return () => undefined
      return (env) => {
        const values: Value[] = new Array(args.length)
        for (let i = 0; i < args.length; i += 1) values[i] = args[i](env)
        return fn(values, env)
      }
    }
    case 'unary': {
      const operand = compileNode(node.operand)
      switch (node.op) {
        case '-':
          return (env) => {
            const x = operand(env)
            return typeof x === 'number' ? -x : undefined
          }
        case '+':
          return (env) => {
            const x = operand(env)
            return typeof x === 'number' ? x : undefined
          }
        case '~':
          return (env) => {
            const x = operand(env)
            return typeof x === 'number' && Number.isInteger(x) ? -x - 1 : undefined
          }
        case 'not':
          return (env) => {
            const x = operand(env)
            return x === undefined ? 1 : truthy(x) ? 0 : 1
          }
      }
      break
    }
    case 'binary': {
      const left = compileNode(node.left)
      const right = compileNode(node.right)
      const op = node.op
      if (op === 'and') {
        return (env) => {
          const a = left(env)
          return truthy(a) ? right(env) : a
        }
      }
      if (op === 'or') {
        return (env) => {
          const a = left(env)
          return truthy(a) ? a : right(env)
        }
      }
      return (env) => binary(op, left(env), right(env))
    }
  }
  return () => undefined
}

const compiledCache = new WeakMap<Node, CompiledExpression>()

/** Compile an AST to a closure (cached per AST node). */
export function compileExpression(ast: Node): CompiledExpression {
  let compiled = compiledCache.get(ast)
  if (!compiled) {
    const inner = compileNode(ast)
    compiled = (env) => {
      try {
        return inner(env)
      } catch {
        return undefined
      }
    }
    compiledCache.set(ast, compiled)
  }
  return compiled
}

/** Evaluate an AST against `env`. `undefined` means no value (Python None / error). */
export function evaluate(ast: Node, env: EvalEnv): Value {
  return compileExpression(ast)(env)
}

/** Python truthiness of an evaluated value (for `{cond}` gates). */
export function isTruthy(value: Value): boolean {
  return truthy(value)
}
