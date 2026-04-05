import {
  Controller, Get, Post, Body, HttpException, HttpStatus,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const interestsFilePath = path.join(process.cwd(), '.user-interests.txt');

@Controller('api/interests')
export class InterestsController {
  @Get()
  getInterests() {
    try {
      const text = fs.existsSync(interestsFilePath)
        ? fs.readFileSync(interestsFilePath, 'utf-8')
        : '';
      return { text };
    } catch (error) {
      console.error('[API] Failed to read interests:', error);
      throw new HttpException('Failed to read interests', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  saveInterests(@Body() body: { text: string }) {
    const { text } = body;
    if (typeof text !== 'string') {
      throw new HttpException('text is required', HttpStatus.BAD_REQUEST);
    }
    try {
      fs.writeFileSync(interestsFilePath, text, 'utf-8');
      return { message: 'Interests saved' };
    } catch (error) {
      console.error('[API] Failed to save interests:', error);
      throw new HttpException('Failed to save interests', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
