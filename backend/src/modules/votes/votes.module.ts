import { Module, forwardRef } from '@nestjs/common';
import { VotesController } from './votes.controller';
import { WebhooksController } from './webhooks.controller';
import { VotesService } from './votes.service';
import { PaymentsModule } from '../payments/payments.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

@Module({
  imports: [
    PrismaModule, 
    PaymentsModule, 
    forwardRef(() => LeaderboardModule),
  ],
  controllers: [VotesController, WebhooksController],
  providers: [VotesService],
  exports: [VotesService],
})
export class VotesModule {}
