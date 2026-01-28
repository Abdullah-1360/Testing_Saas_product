import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [SseController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}