import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidateStatus } from '@prisma/client';

export interface LeaderboardEntry {
  rank: number;
  candidateId: string;
  name: string;
  country: string;
  city: string;
  videoUrl: string;
  thumbnailUrl: string;
  totalVotes: number;
  totalRevenue: number;
  viewCount: number;
  shareCount: number;
  voteChange?: number; // Changement depuis dernière mise à jour
  rankChange?: number; // Changement de classement
}

export interface LeaderboardStats {
  totalCandidates: number;
  totalVotes: number;
  totalRevenue: number;
  lastUpdate: Date;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private cachedLeaderboard: LeaderboardEntry[] = [];
  private lastUpdate: Date = new Date();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Récupérer le classement complet (top 100)
   */
  async getLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
    const candidates = await this.prisma.candidate.findMany({
      where: {
        status: CandidateStatus.APPROVED,
      },
      orderBy: [
        { totalVotes: 'desc' },
        { totalRevenue: 'desc' },
        { createdAt: 'asc' }, // En cas d'égalité, le plus ancien est devant
      ],
      take: limit,
      select: {
        id: true,
        name: true,
        country: true,
        city: true,
        videoUrl: true,
        thumbnailUrl: true,
        totalVotes: true,
        totalRevenue: true,
        viewCount: true,
        shareCount: true,
      },
    });

    // Calculer le rang et les changements
    const leaderboard: LeaderboardEntry[] = candidates.map((candidate, index) => {
      const previousEntry = this.cachedLeaderboard.find(
        (entry) => entry.candidateId === candidate.id,
      );

      return {
        rank: index + 1,
        candidateId: candidate.id,
        name: candidate.name,
        country: candidate.country,
        city: candidate.city,
        videoUrl: candidate.videoUrl,
        thumbnailUrl: candidate.thumbnailUrl || '',
        totalVotes: candidate.totalVotes,
        totalRevenue: candidate.totalRevenue,
        viewCount: candidate.viewCount,
        shareCount: candidate.shareCount,
        voteChange: previousEntry
          ? candidate.totalVotes - previousEntry.totalVotes
          : 0,
        rankChange: previousEntry ? previousEntry.rank - (index + 1) : 0,
      };
    });

    // Mettre à jour le cache
    this.cachedLeaderboard = leaderboard;
    this.lastUpdate = new Date();

    return leaderboard;
  }

  /**
   * Récupérer le top N candidats
   */
  async getTopCandidates(limit: number = 10): Promise<LeaderboardEntry[]> {
    const leaderboard = await this.getLeaderboard(100);
    return leaderboard.slice(0, limit);
  }

  /**
   * Récupérer la position d'un candidat spécifique
   */
  async getCandidateRank(candidateId: string): Promise<{
    entry: LeaderboardEntry | null;
    total: number;
  }> {
    const leaderboard = await this.getLeaderboard(100);
    const entry = leaderboard.find((e) => e.candidateId === candidateId);
    
    // Compter le nombre total de candidats approuvés
    const total = await this.prisma.candidate.count({
      where: { status: CandidateStatus.APPROVED },
    });

    return {
      entry: entry || null,
      total,
    };
  }

  /**
   * Récupérer les statistiques globales du leaderboard
   */
  async getStats(): Promise<LeaderboardStats> {
    const stats = await this.prisma.candidate.aggregate({
      where: {
        status: CandidateStatus.APPROVED,
      },
      _count: { id: true },
      _sum: {
        totalVotes: true,
        totalRevenue: true,
      },
    });

    return {
      totalCandidates: stats._count.id,
      totalVotes: stats._sum.totalVotes || 0,
      totalRevenue: stats._sum.totalRevenue || 0,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Récupérer le leaderboard depuis le cache
   */
  getCachedLeaderboard(): LeaderboardEntry[] {
    return this.cachedLeaderboard;
  }

  /**
   * Forcer la mise à jour du leaderboard
   */
  async refreshLeaderboard(): Promise<LeaderboardEntry[]> {
    this.logger.log('🔄 Rafraîchissement du leaderboard...');
    return await this.getLeaderboard(100);
  }

  /**
   * Récupérer les candidats par pays
   */
  async getLeaderboardByCountry(country: string, limit: number = 20): Promise<LeaderboardEntry[]> {
    const candidates = await this.prisma.candidate.findMany({
      where: {
        status: CandidateStatus.APPROVED,
        country,
      },
      orderBy: [
        { totalVotes: 'desc' },
        { totalRevenue: 'desc' },
        { createdAt: 'asc' },
      ],
      take: limit,
      select: {
        id: true,
        name: true,
        country: true,
        city: true,
        videoUrl: true,
        thumbnailUrl: true,
        totalVotes: true,
        totalRevenue: true,
        viewCount: true,
        shareCount: true,
      },
    });

    return candidates.map((candidate, index) => ({
      rank: index + 1,
      candidateId: candidate.id,
      name: candidate.name,
      country: candidate.country,
      city: candidate.city,
      videoUrl: candidate.videoUrl,
      thumbnailUrl: candidate.thumbnailUrl || '',
      totalVotes: candidate.totalVotes,
      totalRevenue: candidate.totalRevenue,
      viewCount: candidate.viewCount,
      shareCount: candidate.shareCount,
    }));
  }

  /**
   * Récupérer les candidats en compétition serrée (écart < 10 votes)
   */
  async getTightRaces(limit: number = 10): Promise<{
    candidate1: LeaderboardEntry;
    candidate2: LeaderboardEntry;
    voteDifference: number;
  }[]> {
    const leaderboard = await this.getLeaderboard(100);
    const tightRaces: {
      candidate1: LeaderboardEntry;
      candidate2: LeaderboardEntry;
      voteDifference: number;
    }[] = [];

    for (let i = 0; i < leaderboard.length - 1 && tightRaces.length < limit; i++) {
      const voteDiff = leaderboard[i].totalVotes - leaderboard[i + 1].totalVotes;
      
      if (voteDiff > 0 && voteDiff <= 10) {
        tightRaces.push({
          candidate1: leaderboard[i],
          candidate2: leaderboard[i + 1],
          voteDifference: voteDiff,
        });
      }
    }

    return tightRaces;
  }

  /**
   * Récupérer les candidats montants (plus grande progression)
   */
  async getRisingStars(limit: number = 10): Promise<LeaderboardEntry[]> {
    const leaderboard = await this.getLeaderboard(100);
    
    // Trier par voteChange (progression)
    return leaderboard
      .filter((entry) => entry.voteChange && entry.voteChange > 0)
      .sort((a, b) => (b.voteChange || 0) - (a.voteChange || 0))
      .slice(0, limit);
  }
}
