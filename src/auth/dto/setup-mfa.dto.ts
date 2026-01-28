import { IsString } from 'class-validator';

export class SetupMfaDto {
  @IsString()
  token!: string;
}