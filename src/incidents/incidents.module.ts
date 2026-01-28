import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}