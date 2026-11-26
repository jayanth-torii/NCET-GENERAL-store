import { DbError } from '../config/db';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

/**
 * Turns every error into { statusCode, message, ... } JSON.
 * Database constraint errors become readable 409/400 replies instead of 500s.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, ...payload, message: flatten(payload.message) });
      return;
    }

    if (exception instanceof DbError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta?.target as string[] | string | undefined) ?? '';
        res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: uniqueMessage(String(target)) });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found' });
        return;
      }
      if (exception.code === 'P2034') {
        res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: 'Another counter changed the same data. Please try again.' });
        return;
      }
    }

    if (exception instanceof RangeError) {
      res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: exception.message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Something went wrong on the server. The action was not saved.' });
  }
}

function flatten(m: unknown): string {
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' ? m : 'Request failed';
}

function uniqueMessage(target: string): string {
  if (target.includes('product_name_uq') || target.includes('name')) return 'A product or record with this name already exists';
  if (target.includes('purchase_supplier_invoice_uq')) return 'This supplier invoice has already been entered';
  if (target.includes('barcode')) return 'Another product already uses this barcode';
  if (target.includes('code')) return 'This code is already in use';
  if (target.includes('username')) return 'This username is already taken';
  if (target.includes('idempotency')) return 'This bill was already saved';
  return 'A record with the same value already exists';
}
