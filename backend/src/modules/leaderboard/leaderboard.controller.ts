import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Post,
} from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardGateway } from './leaderboard.gateway';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly leaderboardService: LeaderboardService,
    private readonly leaderboardGateway: LeaderboardGateway,
  ) {}

  /**
   * PUBLIC - Récupérer le leaderboard complet
   * GET /leaderboard
   */
  @Public()
  @Get()
  async getLeaderboard(@Query('limit') limit?: string) {
    const leaderboard = await this.leaderboardService.getLeaderboard(
      limit ? parseInt(limit, 10) : 100,
    );
    const stats = await this.leaderboardService.getStats();

    return {
      success: true,
      message: 'Leaderboard récupéré avec succès',
      data: {
        leaderboard,
        stats,
      },
    };
  }

  /**
   * PUBLIC - Récupérer le top N candidats
   * GET /leaderboard/top/:limit
   */
  @Public()
  @Get('top/:limit')
  async getTopCandidates(@Param('limit') limit: string) {
    const topCandidates = await this.leaderboardService.getTopCandidates(
      parseInt(limit, 10),
    );

    return {
      success: true,
      message: `Top ${limit} récupéré avec succès`,
      data: topCandidates,
    };
  }

  /**
   * PUBLIC - Récupérer les statistiques globales
   * GET /leaderboard/stats
   */
  @Public()
  @Get('stats')
  async getStats() {
    const stats = await this.leaderboardService.getStats();

    return {
      success: true,
      message: 'Statistiques récupérées avec succès',
      data: stats,
    };
  }

  /**
   * PUBLIC - Récupérer la position d'un candidat
   * GET /leaderboard/candidate/:id
   */
  @Public()
  @Get('candidate/:id')
  async getCandidateRank(@Param('id') id: string) {
    const result = await this.leaderboardService.getCandidateRank(id);

    return {
      success: true,
      message: 'Position du candidat récupérée avec succès',
      data: result,
    };
  }

  /**
   * PUBLIC - Récupérer le classement par pays
   * GET /leaderboard/country/:country
   */
  @Public()
  @Get('country/:country')
  async getByCountry(
    @Param('country') country: string,
    @Query('limit') limit?: string,
  ) {
    const leaderboard = await this.leaderboardService.getLeaderboardByCountry(
      country,
      limit ? parseInt(limit, 10) : 20,
    );

    return {
      success: true,
      message: `Classement pour ${country} récupéré avec succès`,
      data: leaderboard,
    };
  }

  /**
   * PUBLIC - Récupérer les compétitions serrées
   * GET /leaderboard/tight-races
   */
  @Public()
  @Get('tight-races')
  async getTightRaces(@Query('limit') limit?: string) {
    const tightRaces = await this.leaderboardService.getTightRaces(
      limit ? parseInt(limit, 10) : 10,
    );

    return {
      success: true,
      message: 'Compétitions serrées récupérées avec succès',
      data: tightRaces,
    };
  }

  /**
   * PUBLIC - Récupérer les candidats montants
   * GET /leaderboard/rising-stars
   */
  @Public()
  @Get('rising-stars')
  async getRisingStars(@Query('limit') limit?: string) {
    const risingStars = await this.leaderboardService.getRisingStars(
      limit ? parseInt(limit, 10) : 10,
    );

    return {
      success: true,
      message: 'Candidats montants récupérés avec succès',
      data: risingStars,
    };
  }

  /**
   * ADMIN - Forcer le rafraîchissement du leaderboard
   * POST /leaderboard/refresh
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'MODERATOR')
  @Post('refresh')
  async refreshLeaderboard() {
    const leaderboard = await this.leaderboardService.refreshLeaderboard();
    
    // Déclencher une mise à jour WebSocket
    await this.leaderboardGateway.triggerUpdate();

    return {
      success: true,
      message: 'Leaderboard rafraîchi avec succès',
      data: leaderboard,
    };
  }
}
