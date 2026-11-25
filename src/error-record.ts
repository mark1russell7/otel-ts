/**
 * The error record: an error as data, with the ids of its context.
 *
 * An error that a page or a service shows as bare text loses its context: the
 * trace, the session, the request and the procedure. `errorRecord()` reads them
 * from the active context of the context manager, at the place of the error.
 * A view, a copy, a report and a log line then use the same record.
 *
 * This module depends on `@opentelemetry/api` and `@mark1russell7/text` only.
 * Without an SDK, a record has no trace id, and `reportError()` emits its log
 * record to the no-op logger of the API.
 *
 * The record holds no secret: each text goes through the redaction of
 * `@mark1russell7/text/redact` (the token shapes of known services, and the
 * values of parameters with the name of a secret).
 */
import { context, isSpanContextValid, logs, SeverityNumber, SpanStatusCode, trace, type Attributes, type Context } from "@opentelemetry/api";
import { errorMessage } from "@mark1russell7/text";
import { CONTEXT_SHAPES, redactSecretShapes, SECRET_SHAPES } from "@mark1russell7/text/redact";
import { contextValues } from "./context.js";

/** The format of an error record. A change that breaks a reader gives a new number. */
export const ERROR_RECORD_FORMAT = "otel-ts.error/1";

/** The most causes in a record. A longer chain, or a loop, ends with a cause of the name `CauseLimit`. */
export const MAX_ERROR_CAUSES = 8;

/** The most characters of one stack in a record */
export const MAX_STACK_LENGTH = 4000;

/** One error of the cause chain */
export interface ErrorCause {
  /** The name, for example `TypeError`. A thrown value that is not an error gives its type, for example `string`. */
  readonly name: string;
  /** The message, with no secret */
  readonly message: string;
  /** The `code` of the error, when it has a code of type string or number (for example `ECONNRESET`) */
  readonly code?: string;
  /** The stack, with no secret, when the options ask for it */
  readonly stack?: string;
  /** Where this cause comes from in its parent: `cause`, or `errors[1]` of an `AggregateError` */
  readonly via?: string;
}

/** The procedure that failed */
export interface ErrorProcedure {
  /** The name, for example `fleet.inbox.create` or `GET /api/status` */
  readonly name: string;
  /**
   * The digest of the input, for example the SHA-256 of its canonical JSON (`@mark1russell7/rigor-generators`).
   * It tells two calls with the same input apart from two calls with different inputs. The record never holds the input.
   */
  readonly inputDigest?: string;
}

/** An error as data, with the ids of its context. It is plain JSON. */
export interface ErrorRecord {
  /** Always `ERROR_RECORD_FORMAT` */
  readonly format: typeof ERROR_RECORD_FORMAT;
  /** A random id of this record. A report and the log line give the same id. */
  readonly id: string;
  /** The time of the record, as an ISO 8601 text in UTC */
  readonly at: string;
  /** The name of the error, as in `causes[0]` */
  readonly name: string;
  /** The message of the error, as in `causes[0]` */
  readonly message: string;
  /** The code of the error, as in `causes[0]` */
  readonly code?: string;
  /** The error, then each cause, then each error of an `AggregateError`, depth first */
  readonly causes: readonly ErrorCause[];
  /** The trace id of the active span, when the span context is valid */
  readonly traceId?: string;
  /** The span id of the active span, when the span context is valid */
  readonly spanId?: string;
  /** True when the trace is sampled, thus when a sink can have it */
  readonly sampled?: boolean;
  /** The values of the context keys (`defineContextKeys`) in the context, for example `session.id` and `page` */
  readonly context: Readonly<Record<string, string>>;
  /** The procedure that failed */
  readonly procedure?: ErrorProcedure;
  /** Other facts of the place, for example the URL path of a page or the name of a service, with no secret */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/** The options of `errorRecord()` */
export interface ErrorRecordOptions {
  /** The procedure that failed */
  readonly procedure?: ErrorProcedure;
  /** Other facts of the place. A text value goes through the redaction. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  /** The context. Default: the active context. */
  readonly from?: Context;
  /** The time. Default: now. */
  readonly at?: Date;
  /** Keep the stack of each cause. Default: false, because a stack can tell the paths of a computer. */
  readonly stacks?: boolean;
  /** The id of the record. Default: a random id. */
  readonly id?: string;
}

const redact = (text: string): string => redactSecretShapes(text, { shapes: [...SECRET_SHAPES, ...CONTEXT_SHAPES] });

const isError = (value: unknown): value is Error =>
  value instanceof Error || Object.prototype.toString.call(value) === "[object Error]";

/** The fields of one value of the chain. Each read is guarded, because a getter of the value can throw. */
function causeOf(value: unknown, via: string | undefined, stacks: boolean): ErrorCause {
  const read = (key: string): unknown => {
    try {
      return (value as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  };
  const error = isError(value);
  const rawName = error ? read("name") : undefined;
  const name = error ? (typeof rawName === "string" && rawName !== "" ? rawName : "Error") : value === null ? "null" : typeof value;
  const code = error ? read("code") : undefined;
  const stack = error && stacks ? read("stack") : undefined;
  return {
    name: redact(name),
    message: redact(errorMessage(value)),
    ...(typeof code === "string" || typeof code === "number" ? { code: redact(String(code)) } : {}),
    ...(typeof stack === "string" ? { stack: redact(stack.slice(0, MAX_STACK_LENGTH)) } : {}),
    ...(via === undefined ? {} : { via }),
  };
}

/** The chain of `error`: the error, its `cause`, then the `errors` of an `AggregateError`, depth first, with no loop */
function causesOf(error: unknown, stacks: boolean): ErrorCause[] {
  const causes: ErrorCause[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, via: string | undefined): void => {
    if (causes.length >= MAX_ERROR_CAUSES) return;
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    causes.push(causeOf(value, via, stacks));
    if (!isError(value)) return;
    let cause: unknown;
    let errors: unknown;
    try {
      cause = (value as { cause?: unknown }).cause;
      errors = (value as { errors?: unknown }).errors;
    } catch {
      return;
    }
    if (cause !== undefined) visit(cause, "cause");
    if (Array.isArray(errors)) errors.forEach((each, index) => visit(each, `errors[${index}]`));
  };
  visit(error, undefined);
  if (causes.length >= MAX_ERROR_CAUSES) causes[MAX_ERROR_CAUSES - 1] = { name: "CauseLimit", message: `The chain has ${MAX_ERROR_CAUSES - 1} causes or more. The record ends here.` };
  return causes;
}

/** A random id of 16 bytes as hex, from the Web Crypto API of the platform, else from `Math.random` */
function recordId(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The record of `error`, with the ids of the context: the trace and span id of the active span, the context keys,
 * the procedure and the cause chain. The function never throws, also for a thrown value that is not an error.
 */
export function errorRecord(error: unknown, options: ErrorRecordOptions = {}): ErrorRecord {
  const from = options.from ?? context.active();
  const causes = causesOf(error, options.stacks ?? false);
  const first = causes[0] ?? { name: "unknown", message: "" };
  const span = trace.getSpanContext(from);
  const valid = span !== undefined && isSpanContextValid(span);
  const attributes = options.attributes
    ? Object.fromEntries(Object.entries(options.attributes).map(([key, value]) => [key, typeof value === "string" ? redact(value) : value]))
    : undefined;
  return {
    format: ERROR_RECORD_FORMAT,
    id: options.id ?? recordId(),
    at: (options.at ?? new Date()).toISOString(),
    name: first.name,
    message: first.message,
    ...(first.code === undefined ? {} : { code: first.code }),
    causes,
    ...(valid ? { traceId: span.traceId, spanId: span.spanId, sampled: (span.traceFlags & 1) === 1 } : {}),
    context: Object.fromEntries(Object.entries(contextValues(from)).map(([key, value]) => [key, redact(value)])),
    ...(options.procedure
      ? { procedure: { name: redact(options.procedure.name), ...(options.procedure.inputDigest === undefined ? {} : { inputDigest: options.procedure.inputDigest }) } }
      : {}),
    ...(attributes ? { attributes } : {}),
  };
}

/**
 * The attributes of the log record of an error record, in the names of the semantic conventions
 * (`exception.type`, `exception.message`), with `error.record.id` and the procedure. The trace and span id come with
 * the context of the log record, and the context processors of otel-ts add the context keys.
 */
export function errorLogAttributes(record: ErrorRecord): Attributes {
  return {
    "exception.type": record.name,
    "exception.message": record.message,
    "error.record.id": record.id,
    ...(record.code === undefined ? {} : { "error.code": record.code }),
    ...(record.causes.length > 1 ? { "error.causes": record.causes.slice(1).map((cause) => `${cause.name}: ${cause.message}`) } : {}),
    ...(record.procedure ? { "error.procedure": record.procedure.name } : {}),
    ...(record.procedure?.inputDigest === undefined ? {} : { "error.input_digest": record.procedure.inputDigest }),
    ...(record.attributes ?? {}),
  };
}

/** The options of `reportError()` */
export interface ReportErrorOptions extends ErrorRecordOptions {
  /** The scope of the logger. Default: `otel-ts`. */
  readonly logger?: string;
  /** Mark the active span as failed, with the exception. Default: true. */
  readonly markSpan?: boolean;
}

/**
 * Make the record of `error`, emit it as one log record of severity ERROR in the same context, and mark the active
 * span as failed. The view, the log line and the span thus give the same ids. Without an SDK, the log record and the
 * span go to the no-op of the API, and the record stays.
 */
export function reportError(error: unknown, options: ReportErrorOptions = {}): ErrorRecord {
  const from = options.from ?? context.active();
  const record = errorRecord(error, { ...options, from });
  logs.getLogger(options.logger ?? "otel-ts").emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: record.procedure ? `${record.procedure.name}: ${record.message}` : record.message,
    attributes: errorLogAttributes(record),
    context: from,
  });
  if (options.markSpan ?? true) {
    const span = trace.getSpan(from);
    if (span?.isRecording()) {
      span.recordException({ name: record.name, message: record.message });
      span.setStatus({ code: SpanStatusCode.ERROR, message: record.message });
    }
  }
  return record;
}

/**
 * A copy of `record` with each text through the redaction. `errorRecord()` already redacts. Use this function for a
 * record from another place, for example the JSON of a server, before a view shows it or a person copies it.
 * It is idempotent: a second pass changes nothing.
 */
export function redactErrorRecord(record: ErrorRecord): ErrorRecord {
  const text = (value: unknown): string => redact(String(value ?? ""));
  const strings = (values: Readonly<Record<string, unknown>> | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [text(key), text(value)]));
  const causes = Array.isArray(record.causes) ? record.causes : [];
  return {
    format: ERROR_RECORD_FORMAT,
    id: text(record.id),
    at: text(record.at),
    name: text(record.name),
    message: text(record.message),
    ...(record.code === undefined ? {} : { code: text(record.code) }),
    causes: causes.slice(0, MAX_ERROR_CAUSES).map((cause) => ({
      name: text(cause.name),
      message: text(cause.message),
      ...(cause.code === undefined ? {} : { code: text(cause.code) }),
      ...(cause.stack === undefined ? {} : { stack: text(cause.stack).slice(0, MAX_STACK_LENGTH) }),
      ...(cause.via === undefined ? {} : { via: text(cause.via) }),
    })),
    ...(record.traceId === undefined ? {} : { traceId: text(record.traceId) }),
    ...(record.spanId === undefined ? {} : { spanId: text(record.spanId) }),
    ...(record.sampled === undefined ? {} : { sampled: record.sampled === true }),
    context: strings(record.context),
    ...(record.procedure
      ? { procedure: { name: text(record.procedure.name), ...(record.procedure.inputDigest === undefined ? {} : { inputDigest: text(record.procedure.inputDigest) }) } }
      : {}),
    ...(record.attributes
      ? { attributes: Object.fromEntries(Object.entries(record.attributes).map(([key, value]) => [text(key), typeof value === "string" ? text(value) : typeof value === "number" || typeof value === "boolean" ? value : text(value)])) }
      : {}),
  };
}

/**
 * The record as a text to copy or to paste in a report: the message, then each id, then the cause chain, then the
 * record as JSON. A reader with no tool reads the top, and a tool reads the JSON. The record goes through
 * `redactErrorRecord()` first, so a record from another place gives no secret either.
 */
export function errorRecordText(input: ErrorRecord): string {
  const record = redactErrorRecord(input);
  const lines = [`${record.name}: ${record.message}`, ""];
  const row = (label: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") lines.push(`${label}: ${value}`);
  };
  row("Time", record.at);
  row("Record", record.id);
  row("Procedure", record.procedure?.name);
  row("Input digest", record.procedure?.inputDigest);
  row("Trace", record.traceId);
  row("Span", record.spanId);
  for (const [key, value] of Object.entries(record.context)) row(key, value);
  for (const cause of record.causes.slice(1)) row(`Cause (${cause.via ?? "cause"})`, `${cause.name}: ${cause.message}`);
  lines.push("", JSON.stringify(record, null, 2));
  return lines.join("\n");
}
