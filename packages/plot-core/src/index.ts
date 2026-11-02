// @arduconfig/plot-core — the graph engine behind the plot workspace:
// MAVExplorer's predefined graphs and expression language, evaluated over
// DataFlash logs or live MAVLink. Pure TypeScript, no runtime dependencies.

export type { EvalEnv, MessageRecord, Value, Vec3 } from './types.js'
export {
  collectFunctions,
  collectReferences,
  compileExpression,
  evaluate,
  isTruthy,
  parseExpression,
  parseFormula,
  parseTerm,
  termFunctions,
  termReferences
} from './expression.js'
export type {
  BinaryOp,
  CompiledExpression,
  ExpressionError,
  Node,
  ParseResult,
  Reference,
  Term,
  TermResult,
  UnaryOp
} from './expression.js'
export { SUPPORTED_FUNCTIONS, lookupFunction } from './functions.js'
export type { ExpressionFunction } from './functions.js'
export { graphTree, resolveGraph, searchGraphs, termUnavailableReason } from './graph-library.js'
export type { DataAvailability, GraphDefinition, GraphTreeNode, ResolvedGraph } from './graph-library.js'
export {
  createGraphEvaluator,
  createTermEvaluator,
  dataflashFieldIndex,
  dataflashInstanceColumn,
  dataflashParams,
  evaluateOnDataflash,
  seriesFromField
} from './evaluator.js'
export type {
  DataflashFieldIndex,
  DataflashFormatLike,
  DataflashLogLike,
  DataflashMessageInfo,
  EvaluatorOptions,
  GraphEvaluator,
  Series,
  TermEvaluator
} from './evaluator.js'
export { MAVGRAPHS } from './generated/mavgraphs.js'
