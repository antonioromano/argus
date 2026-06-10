import type { Request, Response, NextFunction, ErrorRequestHandler, RequestHandler } from 'express';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
