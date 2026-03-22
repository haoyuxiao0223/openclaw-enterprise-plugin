/**
 * Middleware framework types — chainable request/response pipeline.
 */

import type { TenantContext } from "../kernel/tenant-context.ts";

export interface MiddlewareRequest {
  tenantContext?: TenantContext;
  path: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  params: Record<string, string>;
  ip?: string;
  userAgent?: string;

  locals: Record<string, unknown>;
}

export interface MiddlewareResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;

  setStatus(code: number): MiddlewareResponse;
  setHeader(key: string, value: string): MiddlewareResponse;
  json(data: unknown): void;
  send(data: unknown): void;
  end(): void;
}

export type NextFunction = () => Promise<void>;

export type Middleware = (
  req: MiddlewareRequest,
  res: MiddlewareResponse,
  next: NextFunction,
) => Promise<void>;

export class MiddlewarePipeline {
  private readonly stack: Middleware[] = [];

  use(mw: Middleware): this {
    this.stack.push(mw);
    return this;
  }

  async execute(req: MiddlewareRequest, res: MiddlewareResponse): Promise<void> {
    let index = 0;
    const next: NextFunction = async () => {
      if (index < this.stack.length) {
        const mw = this.stack[index++]!;
        await mw(req, res, next);
      }
    };
    await next();
  }
}
