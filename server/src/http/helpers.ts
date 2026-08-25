import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notImplemented: RequestHandler = (_req, res) => {
  res.status(501).json({ error: 'not implemented yet (port in progress)' });
};

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

export function asyncHandler(handler: Handler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    try {
      (req as Request & { parsedBody?: unknown }).parsedBody = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new HttpError(422, err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      } else {
        next(err);
      }
    }
  };
}
