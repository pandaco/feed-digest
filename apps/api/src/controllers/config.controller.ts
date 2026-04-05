import { Controller, Get } from '@nestjs/common';

@Controller('api/config')
export class ConfigController {
  @Get()
  getConfig() {
    return {
      dateFormat: process.env['DATE_FORMAT'] || 'yyyy-MM-dd HH:mm',
    };
  }
}
