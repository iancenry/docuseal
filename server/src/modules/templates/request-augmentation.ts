declare module 'express-serve-static-core' {
  interface Request {
    parsedBody?: unknown;
  }
}

export {};
