import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly secretToken: string;

  constructor() {
    this.secretToken = process.env['TELEGRAM_SECRET_TOKEN'] || '';
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.secretToken) {
      next();
      return;
    }
    const headerToken = req.headers['x-telegram-bot-api-secret-token'];
    if (headerToken !== this.secretToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }
}
