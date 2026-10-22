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
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Erro interno',
      path: req.originalUrl,
    });
  }
}
