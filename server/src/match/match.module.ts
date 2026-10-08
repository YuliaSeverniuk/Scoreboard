import { Module } from '@nestjs/common';
import { MatchGateway } from './match.gateway';
import { MatchService } from './match.service';
import { FileStateStore, StateStore } from './state-store';

@Module({
  providers: [MatchService, MatchGateway, { provide: StateStore, useClass: FileStateStore }],
})
export class MatchModule {}