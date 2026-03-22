/**
 * MessageEnvelope — standardized API message wrapper (PRD §5.4).
 */

export interface MessageEnvelope<T = unknown> {
  id: string;
  version: string;
  tenantId: string;
  agentId: string;
  sessionKey?: string;
  idempotencyKey?: string;

  direction: "inbound" | "outbound";
  contentType: "text" | "tool_call" | "tool_result" | "media" | "system";
  payload: T;
  metadata: EnvelopeMetadata;

  createdAt: Date;
  processedAt?: Date;
}

export interface EnvelopeMetadata {
  source?: string;
  channel?: string;
  replyTo?: string;
  traceId?: string;
  priority?: "high" | "normal" | "low";
  ttlMs?: number;
  headers?: Record<string, string>;
}

export interface MessageEnvelopeFactory {
  create<T>(input: EnvelopeInput<T>): MessageEnvelope<T>;
  validate(envelope: MessageEnvelope): EnvelopeValidationResult;
  wrap<T>(tenantId: string, agentId: string, payload: T, options?: Partial<EnvelopeInput<T>>): MessageEnvelope<T>;
}

export interface EnvelopeInput<T = unknown> {
  tenantId: string;
  agentId: string;
  sessionKey?: string;
  idempotencyKey?: string;
  direction: "inbound" | "outbound";
  contentType: MessageEnvelope["contentType"];
  payload: T;
  metadata?: Partial<EnvelopeMetadata>;
}

export interface EnvelopeValidationResult {
  valid: boolean;
  errors: string[];
}
