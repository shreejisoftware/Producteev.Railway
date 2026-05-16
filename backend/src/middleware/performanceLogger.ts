import { Request, Response, NextFunction } from 'express';

/** Only log genuinely slow routes; 100ms flagged almost every DB/API call as "slow". */
const parsedSlow = Number(process.env.SLOW_REQUEST_MS);
const SLOW_MS =
  Number.isFinite(parsedSlow) && parsedSlow >= 200 ? parsedSlow : 2000;

export const performanceLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > SLOW_MS) {
      console.warn(`[SLOW REQUEST] ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
  });

  next();
};
