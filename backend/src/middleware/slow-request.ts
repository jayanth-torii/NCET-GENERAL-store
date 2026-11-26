import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const log = new Logger('SlowRequest');

/**
 * Logs every API request that takes longer than `limitMs` (default 3 s, env SLOW_REQUEST_MS).
 * MongoDB Atlas sometimes drops connections from the store network; a request then waits for the
 * driver to reconnect and still succeeds, so nothing else would show why the screen was slow.
 */
export function slowRequestLogger(limitMs = Number(process.env.SLOW_REQUEST_MS ?? 3000)) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (ms >= limitMs) log.warn(`${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode} took ${(ms / 1000).toFixed(1)} s`);
    });
    next();
  };
}
