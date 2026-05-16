import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { config } from '../config';

function isDatabaseConnectionError(err: Error): boolean {
  const errorCode = (err as Error & { code?: string }).code;
  const errorMessage = err.message.toLowerCase();

  return Boolean(
    errorCode === 'P1001' ||
    errorCode === 'P1002' ||
    errorCode === 'P1008' ||
    err.name === 'PrismaClientInitializationError' ||
    errorMessage.includes("can't reach database server") ||
    errorMessage.includes('database server closed') ||
    errorMessage.includes('database server has closed the connection')
  );
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log all errors for debugging
  const errorId = `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const statusHint = err instanceof ApiError ? err.statusCode : undefined;
  const isExpectedAuthFailure = statusHint === 401;

  if (!isExpectedAuthFailure) {
    console.error(`[ERROR-${errorId}] ${_req.method} ${_req.path} → ${err.constructor.name}: ${err.message}`);
  }
  
  // Log detailed stack trace in development
  if (config.NODE_ENV === 'development') {
    console.error('Stack trace:', err.stack);
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: Object.keys(err.errors).length > 0 ? err.errors : undefined,
      ...(config.NODE_ENV === 'development' && { errorId }),
    });
    return;
  }

  // Check for Zod errors (instanceof + name check for hot-reload safety)
  if (err instanceof ZodError || (err.name === 'ZodError' && 'issues' in err)) {
    const zodErr = err as ZodError;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of zodErr.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: fieldErrors,
      ...(config.NODE_ENV === 'development' && { errorId }),
    });
    return;
  }

  // Handle JWT errors as 401 (not 500)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      message: err.message === 'jwt expired' ? 'Token expired' : 'Invalid token',
      ...(config.NODE_ENV === 'development' && { errorId }),
    });
    return;
  }

  // Handle true database connection failures as 503
  if (isDatabaseConnectionError(err) || err.message.includes('ECONNREFUSED')) {
    console.error(`[DB-ERROR-${errorId}] Database connection issue:`, err.message);
    res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable',
      ...(config.NODE_ENV === 'development' && { 
        errorId,
        detail: 'Database connection error: ' + err.message 
      }),
    });
    return;
  }

  console.error(`[UNHANDLED-${errorId}]`, 'Unhandled error stack:', err.stack);

  res.status(500).json({
    success: false,
    message: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(config.NODE_ENV === 'development' && { 
      errorId,
      stack: err.stack?.split('\n').slice(0, 5)
    }),
  });
};
