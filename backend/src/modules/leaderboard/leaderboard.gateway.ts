import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { LeaderboardService } from './leaderboard.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/leaderboard',
})
export class LeaderboardGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LeaderboardGateway.name);
  private updateInterval: NodeJS.Timeout | null = null;
  private connectedClients = 0;

  constructor(private readonly leaderboardService: LeaderboardService) {}

  /**
   * Initialisation du gateway WebSocket
   */
  afterInit(server: Server) {
    this.logger.log('🚀 WebSocket Gateway initialisé sur namespace /leaderboard');
    
    // Démarrer les mises à jour automatiques toutes les 10 secondes
    this.startAutoUpdates();
  }

  /**
   * Gestion de la connexion d'un client
   */
  handleConnection(client: Socket) {
    this.connectedClients++;
    this.logger.log(
      `✅ Client connecté: ${client.id} | Total: ${this.connectedClients}`,
    );

    // Envoyer immédiatement le leaderboard au nouveau client
    this.sendLeaderboardToClient(client);
  }

  /**
   * Gestion de la déconnexion d'un client
   */
  handleDisconnect(client: Socket) {
    this.connectedClients--;
    this.logger.log(
      `❌ Client déconnecté: ${client.id} | Total: ${this.connectedClients}`,
    );
  }

  /**
   * Démarrer les mises à jour automatiques du leaderboard
   */
  private startAutoUpdates() {
    // Nettoyer l'intervalle existant s'il y en a un
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Mettre à jour toutes les 10 secondes
    this.updateInterval = setInterval(async () => {
      await this.broadcastLeaderboardUpdate();
    }, 10000); // 10 secondes

    this.logger.log('⏰ Mises à jour automatiques démarrées (toutes les 10s)');
  }

  /**
   * Arrêter les mises à jour automatiques
   */
  private stopAutoUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      this.logger.log('⏸️ Mises à jour automatiques arrêtées');
    }
  }

  /**
   * Diffuser le leaderboard mis à jour à tous les clients
   */
  async broadcastLeaderboardUpdate() {
    try {
      const leaderboard = await this.leaderboardService.refreshLeaderboard();
      const stats = await this.leaderboardService.getStats();

      this.server.emit('leaderboard:update', {
        leaderboard,
        stats,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(
        `📡 Leaderboard diffusé à ${this.connectedClients} clients`,
      );
    } catch (error) {
      this.logger.error(
        `Erreur lors de la diffusion du leaderboard: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Envoyer le leaderboard à un client spécifique
   */
  private async sendLeaderboardToClient(client: Socket) {
    try {
      const leaderboard = await this.leaderboardService.getLeaderboard(100);
      const stats = await this.leaderboardService.getStats();

      client.emit('leaderboard:initial', {
        leaderboard,
        stats,
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(`📤 Leaderboard initial envoyé à ${client.id}`);
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'envoi du leaderboard: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Recevoir une demande de rafraîchissement du leaderboard
   */
  @SubscribeMessage('leaderboard:refresh')
  async handleRefresh(@ConnectedSocket() client: Socket) {
    this.logger.log(`🔄 Demande de rafraîchissement de ${client.id}`);
    await this.sendLeaderboardToClient(client);
  }

  /**
   * Recevoir une demande de classement pour un candidat spécifique
   */
  @SubscribeMessage('leaderboard:candidate-rank')
  async handleCandidateRank(
    @MessageBody() data: { candidateId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(
      `📊 Demande de rang pour candidat ${data.candidateId} de ${client.id}`,
    );

    try {
      const result = await this.leaderboardService.getCandidateRank(
        data.candidateId,
      );

      client.emit('leaderboard:candidate-rank-response', {
        candidateId: data.candidateId,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('leaderboard:error', {
        message: 'Impossible de récupérer le rang du candidat',
        error: error.message,
      });
    }
  }

  /**
   * Recevoir une demande de top N candidats
   */
  @SubscribeMessage('leaderboard:top')
  async handleTopRequest(
    @MessageBody() data: { limit?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const limit = data.limit || 10;
    this.logger.log(`🏆 Demande de top ${limit} de ${client.id}`);

    try {
      const topCandidates = await this.leaderboardService.getTopCandidates(
        limit,
      );

      client.emit('leaderboard:top-response', {
        limit,
        candidates: topCandidates,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('leaderboard:error', {
        message: 'Impossible de récupérer le top candidats',
        error: error.message,
      });
    }
  }

  /**
   * Recevoir une demande de classement par pays
   */
  @SubscribeMessage('leaderboard:by-country')
  async handleByCountry(
    @MessageBody() data: { country: string; limit?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const limit = data.limit || 20;
    this.logger.log(
      `🌍 Demande de classement pour ${data.country} de ${client.id}`,
    );

    try {
      const leaderboard = await this.leaderboardService.getLeaderboardByCountry(
        data.country,
        limit,
      );

      client.emit('leaderboard:by-country-response', {
        country: data.country,
        leaderboard,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      client.emit('leaderboard:error', {
        message: 'Impossible de récupérer le classement par pays',
        error: error.message,
      });
    }
  }

  /**
   * Forcer une mise à jour immédiate du leaderboard (appelé par VotesService)
   */
  async triggerUpdate() {
    this.logger.log('⚡ Mise à jour forcée du leaderboard');
    await this.broadcastLeaderboardUpdate();
  }
}
