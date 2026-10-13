import type { Request, Response, NextFunction, ErrorRequestHandler, RequestHandler } from 'express';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Client errors raised by middleware (body-parser's 413 "too large", 400
  // malformed JSON) carry their status; answer with it instead of a 500.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? 'Request body too large' : 'Bad request' });
    return;
  }
  console.error('[server] unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
