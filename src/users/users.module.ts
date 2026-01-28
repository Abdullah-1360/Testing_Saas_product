import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';
import { AuditModule } from '@/audit/audit.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [DatabaseModule, CommonModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}