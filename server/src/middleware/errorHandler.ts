import type { Request, Response, NextFunction, ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@argus/shared';
import { ArgusError } from '../errors/ArgusError.js';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // A failure a route or service already classified: answer with its class.
  if (err instanceof ArgusError) {
    if (!res.headersSent) res.status(err.status).json(err.toBody());
    return;
  }
  // Client errors raised by middleware (body-parser's 413 "too large", 400
  // malformed JSON) carry their status; answer with it instead of a 500.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? 'Request body too large' : 'Bad request' });
    return;
  }
  console.error('[server] unhandled error:', err);
  if (!res.headersSent) {
    const body: ApiErrorBody = { error: 'Internal server error', code: 'INTERNAL' };
    res.status(500).json(body);
  }
};
