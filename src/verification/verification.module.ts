import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';
import { VerificationService } from './services/verification.service';
import { VerificationController } from './controllers/verification.controller';

@Module({
  imports: [
    DatabaseModule,
    CommonModule,
  ],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}