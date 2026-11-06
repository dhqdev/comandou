import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Formato único de erro. Erros inesperados não vazam mensagem/stack ao cliente. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string' ? { message: body } : { ...(body as Record<string, unknown>) };
      res.status(status).json({ statusCode: status, ...payload, path: req.originalUrl });
      return;
    }
    // Violações de integridade do Postgres viram 4xx claros (sem expor detalhes do banco).
    const pgCode = (exception as { code?: string } | null)?.code;
    const mapped: Record<string, [number, string]> = {
      '23505': [409, 'Registro duplicado'],
      '23503': [422, 'Referência inválida'],
      '23514': [422, 'Valor fora das regras permitidas'],
      '40001': [409, 'Conflito de concorrência; tente novamente'],
      '40P01': [409, 'Conflito de concorrência; tente novamente'],
    };
    if (pgCode && mapped[pgCode]) {
      const [status, message] = mapped[pgCode];
      res.status(status).json({ statusCode: status, message, path: req.originalUrl });
      return;
    }
    // Banco lento ou cheio (consulta cancelada pelo tempo limite, sem conexão livre): é passageiro.
    // 503 diz ao app que pode tentar de novo, e o erro de um restaurante não vira "erro interno".
    if (isDatabaseBusy(exception)) {
      this.logger.warn(
        `banco ocupado em ${req.method} ${req.originalUrl}: ${(exception as Error).message}`,
      );
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: 503,
        message: 'O sistema está demorando para responder. Tente de novo em instantes.',
        path: req.originalUrl,
      });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Erro interno',
      path: req.originalUrl,
    });
  }
}

/** Erros passageiros do banco: tempo limite da consulta, pool sem conexão livre, banco fora. */
export function isDatabaseBusy(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  // 57014 = query_canceled (statement_timeout); 57P01/57P03 = banco reiniciando.
  if (err.code === '57014' || err.code === '57P01' || err.code === '57P03') return true;
  if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') return true;
  const m = err.message ?? '';
  return (
    m.includes('timeout exceeded when trying to connect') ||
    m.includes('Connection terminated due to connection timeout') ||
    m.includes('Query read timeout')
  );
}
