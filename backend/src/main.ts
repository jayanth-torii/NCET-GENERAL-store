import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import Decimal from 'decimal.js';
import cookieParser from 'cookie-parser';
import { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './middleware/http-exception.filter';
import { slowRequestLogger } from './middleware/slow-request';

// Money goes out as numbers with their exact decimal value; ids that are BigInt in the database go out as numbers.
(Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Decimal) {
  return this.toNumber();
};
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

async function bootstrap() {
  if (!process.env.TZ) process.env.TZ = 'Asia/Kolkata';
  const httpsOptions =
    process.env.HTTPS_CERT_FILE && process.env.HTTPS_KEY_FILE
      ? { cert: readFileSync(process.env.HTTPS_CERT_FILE), key: readFileSync(process.env.HTTPS_KEY_FILE) }
      : undefined;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { httpsOptions, bodyParser: true });
  app.useBodyParser('json', { limit: '1mb' });
  app.disable('x-powered-by');
  app.use(cookieParser());
  // Behind an HTTPS reverse proxy, trust its X-Forwarded-* headers so cookies are marked secure and IPs are real.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Only this origin may run scripts; images may be inline drawings (product pictures, QR codes).
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  // API responses must never be cached by the browser.
  app.use('/api', slowRequestLogger());
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Store POS running on ${httpsOptions ? 'https' : 'http'}://0.0.0.0:${port}`, 'Bootstrap');
}

void bootstrap();
