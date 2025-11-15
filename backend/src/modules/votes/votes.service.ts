import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateVoteDto, QueryVotesDto } from './dto';
import {
  PaymentMethod,
  PaymentStatus,
  CandidateStatus,
  Prisma,
} from '@prisma/client';

@Injectable()
export class VotesService {
  private readonly logger = new Logger(VotesService.name);
  private readonly VOTE_AMOUNT = 100; // 100 FCFA par vote

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => 'LeaderboardGateway'))
    private readonly leaderboardGateway?: any,
  ) {}

  /**
   * Créer un nouveau vote et initialiser le paiement
   */
  async create(
    createVoteDto: CreateVoteDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const { candidateId, paymentMethod, phone, email, voterName, message } =
      createVoteDto;

    // 1. Vérifier que le candidat existe et est APPROVED
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
    });

    if (!candidate) {
      throw new NotFoundException('Candidat introuvable');
    }

    if (candidate.status !== CandidateStatus.APPROVED) {
      throw new BadRequestException(
        'Ce candidat n\'est pas encore validé pour recevoir des votes',
      );
    }

    // 2. Vérifier que l'IP n'est pas blacklistée
    if (ipAddress) {
      const isBlacklisted = await this.prisma.ipBlacklist.findFirst({
        where: {
          ipAddress,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });

      if (isBlacklisted) {
        throw new ForbiddenException(
          'Cette adresse IP a été bloquée pour activités suspectes',
        );
      }
    }

    // 3. Valider les données selon la méthode de paiement
    if (
      (paymentMethod === PaymentMethod.MTN_MOBILE_MONEY ||
        paymentMethod === PaymentMethod.ORANGE_MONEY) &&
      !phone
    ) {
      throw new BadRequestException(
        'Le numéro de téléphone est requis pour ce mode de paiement',
      );
    }

    if (paymentMethod === PaymentMethod.CARD && !email) {
      throw new BadRequestException(
        'L\'email est requis pour le paiement par carte',
      );
    }

    // 4. Générer une référence unique
    const transactionId = this.generateTransactionId();

    // 5. Déterminer le provider
    let paymentProvider: string;
    switch (paymentMethod) {
      case PaymentMethod.MTN_MOBILE_MONEY:
        paymentProvider = 'mtn';
        break;
      case PaymentMethod.ORANGE_MONEY:
        paymentProvider = 'orange';
        break;
      case PaymentMethod.CARD:
        paymentProvider = 'stripe';
        break;
      default:
        paymentProvider = 'unknown';
    }

    // 6. Créer le vote avec statut PENDING
    const vote = await this.prisma.vote.create({
      data: {
        candidateId,
        amount: this.VOTE_AMOUNT,
        currency: 'XOF',
        paymentMethod,
        paymentProvider,
        paymentStatus: PaymentStatus.PENDING,
        transactionId,
        voterPhone: phone,
        voterEmail: email,
        voterName,
        ipAddress: ipAddress || 'unknown',
        userAgent,
      },
      include: {
        candidate: {
          select: {
            id: true,
            name: true,
            videoUrl: true,
            thumbnailUrl: true,
          },
        },
      },
    });

    // 7. Initialiser le paiement via le provider
    try {
      const paymentResult = await this.paymentsService.initializePayment(
        paymentMethod,
        {
          amount: this.VOTE_AMOUNT,
          currency: 'XOF',
          reference: transactionId,
          callbackUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/vote/callback`,
          webhookUrl: `${process.env.API_URL || 'http://localhost:4000'}/webhooks/${paymentProvider}`,
          customerPhone: phone,
          customerEmail: email,
          customerName: voterName,
          description: `Vote pour ${candidate.name}`,
        },
      );

      // 8. Mettre à jour le vote avec l'ID du provider
      const updatedVote = await this.prisma.vote.update({
        where: { id: vote.id },
        data: {
          providerTxId: paymentResult.providerReference,
        },
        include: {
          candidate: {
            select: {
              id: true,
              name: true,
              videoUrl: true,
              thumbnailUrl: true,
            },
          },
        },
      });

      // 9. Créer l'enregistrement Transaction
      await this.prisma.transaction.create({
        data: {
          voteId: vote.id,
          amount: this.VOTE_AMOUNT,
          currency: 'XOF',
          paymentMethod,
          provider: paymentProvider,
          providerReference: paymentResult.providerReference || transactionId,
          status: PaymentStatus.PENDING,
          initResponse: paymentResult.data || {},
          customerEmail: email,
          customerPhone: phone,
        },
      });

      return {
        vote: updatedVote,
        payment: {
          success: paymentResult.success,
          checkoutUrl: paymentResult.data?.checkoutUrl,
          providerReference: paymentResult.providerReference,
          message: paymentResult.message,
        },
      };
    } catch (error) {
      // En cas d'erreur, marquer le vote comme FAILED
      await this.prisma.vote.update({
        where: { id: vote.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
        },
      });

      this.logger.error(
        `Erreur lors de l'initialisation du paiement: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        'Impossible d\'initialiser le paiement. Veuillez réessayer.',
      );
    }
  }

  /**
   * Traiter la confirmation d'un paiement (appelé par les webhooks)
   */
  async confirmPayment(
    providerTxId: string,
    status: PaymentStatus,
    webhookPayload?: any,
  ) {
    // 1. Trouver le vote correspondant
    const vote = await this.prisma.vote.findFirst({
      where: { providerTxId },
      include: { 
        candidate: true,
        transaction: true 
      },
    });

    if (!vote) {
      this.logger.warn(
        `Vote introuvable pour la référence provider: ${providerTxId}`,
      );
      return null;
    }

    // 2. Vérifier que le vote n'a pas déjà été traité
    if (vote.paymentStatus === PaymentStatus.COMPLETED) {
      this.logger.warn(`Vote déjà confirmé: ${vote.id}`);
      return vote;
    }

    // 3. Mettre à jour le vote
    const updatedVote = await this.prisma.vote.update({
      where: { id: vote.id },
      data: {
        paymentStatus: status,
        paidAt: status === PaymentStatus.COMPLETED ? new Date() : undefined,
        isVerified: status === PaymentStatus.COMPLETED,
        verifiedAt: status === PaymentStatus.COMPLETED ? new Date() : undefined,
      },
    });

    // 4. Mettre à jour la transaction
    if (vote.transaction) {
      await this.prisma.transaction.update({
        where: { id: vote.transaction.id },
        data: {
          status,
          webhookPayload: webhookPayload || {},
        },
      });
    }

    // 5. Si le paiement est confirmé, mettre à jour le candidat
    if (status === PaymentStatus.COMPLETED) {
      await this.prisma.candidate.update({
        where: { id: vote.candidateId },
        data: {
          totalVotes: { increment: 1 },
          totalRevenue: { increment: vote.amount },
        },
      });

      this.logger.log(
        `Vote confirmé avec succès: ${vote.id} pour le candidat ${vote.candidate.name}`,
      );

      // 6. Déclencher la mise à jour du leaderboard en temps réel
      if (this.leaderboardGateway && this.leaderboardGateway.triggerUpdate) {
        try {
          await this.leaderboardGateway.triggerUpdate();
          this.logger.debug('⚡ Leaderboard mis à jour en temps réel');
        } catch (error) {
          this.logger.warn(
            `Impossible de mettre à jour le leaderboard: ${error.message}`,
          );
        }
      }
    }

    return updatedVote;
  }

  /**
   * Récupérer tous les votes avec filtres et pagination
   */
  async findAll(query: QueryVotesDto) {
    const {
      candidateId,
      paymentMethod,
      paymentStatus,
      phone,
      transactionRef,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = query;

    // Construire le filtre WHERE
    const where: Prisma.VoteWhereInput = {};

    if (candidateId) {
      where.candidateId = candidateId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    if (phone) {
      where.voterPhone = { contains: phone };
    }

    if (transactionRef) {
      where.transactionId = transactionRef;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Construire le tri
    const orderBy: Prisma.VoteOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    // Pagination
    const skip = (page - 1) * limit;
    const take = limit;

    // Exécuter les requêtes
    const [votes, total] = await Promise.all([
      this.prisma.vote.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          candidate: {
            select: {
              id: true,
              name: true,
              videoUrl: true,
              thumbnailUrl: true,
            },
          },
          transaction: true,
        },
      }),
      this.prisma.vote.count({ where }),
    ]);

    return {
      data: votes,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Récupérer un vote par son ID
   */
  async findOne(id: string) {
    const vote = await this.prisma.vote.findUnique({
      where: { id },
      include: {
        candidate: {
          select: {
            id: true,
            name: true,
            videoUrl: true,
            thumbnailUrl: true,
            status: true,
          },
        },
        transaction: true,
      },
    });

    if (!vote) {
      throw new NotFoundException('Vote introuvable');
    }

    return vote;
  }

  /**
   * Récupérer les statistiques des votes
   */
  async getStats(candidateId?: string) {
    const where: Prisma.VoteWhereInput = {
      paymentStatus: PaymentStatus.COMPLETED,
    };

    if (candidateId) {
      where.candidateId = candidateId;
    }

    // Total des votes et revenus
    const totalStats = await this.prisma.vote.aggregate({
      where,
      _count: { id: true },
      _sum: { amount: true },
    });

    // Votes par méthode de paiement
    const votesByMethod = await this.prisma.vote.groupBy({
      by: ['paymentMethod'],
      where,
      _count: { id: true },
      _sum: { amount: true },
    });

    // Votes par statut
    const votesByStatus = await this.prisma.vote.groupBy({
      by: ['paymentStatus'],
      _count: { id: true },
    });

    // Evolution des votes (30 derniers jours)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const votesHistory = await this.prisma.vote.groupBy({
      by: ['createdAt'],
      where: {
        ...where,
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { id: true },
    });

    return {
      total: {
        votes: totalStats._count.id,
        revenue: totalStats._sum.amount || 0,
      },
      byMethod: votesByMethod.map((item) => ({
        method: item.paymentMethod,
        count: item._count.id,
        revenue: item._sum.amount || 0,
      })),
      byStatus: votesByStatus.map((item) => ({
        status: item.paymentStatus,
        count: item._count.id,
      })),
      history: votesHistory.map((item) => ({
        date: item.createdAt,
        count: item._count.id,
      })),
    };
  }

  /**
   * Vérifier le statut d'un paiement
   */
  async checkPaymentStatus(id: string) {
    const vote = await this.findOne(id);

    if (!vote.providerTxId) {
      throw new BadRequestException(
        'Aucune référence de paiement pour ce vote',
      );
    }

    try {
      const status = await this.paymentsService.getTransactionStatus(
        vote.providerTxId,
        vote.paymentMethod,
      );

      // Mettre à jour si le statut a changé
      if (status.status.toUpperCase() !== vote.paymentStatus) {
        const newStatus = status.status.toUpperCase() as PaymentStatus;
        return await this.confirmPayment(
          vote.providerTxId,
          newStatus,
          status,
        );
      }

      return vote;
    } catch (error) {
      this.logger.error(
        `Erreur lors de la vérification du statut: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        'Impossible de vérifier le statut du paiement',
      );
    }
  }

  /**
   * Générer une référence de transaction unique
   */
  private generateTransactionId(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `VOTE-${year}${month}${day}-${random}`;
  }

  /**
   * Obtenir les top votants (pour admin)
   */
  async getTopVoters(limit: number = 20) {
    const topVoters = await this.prisma.vote.groupBy({
      by: ['voterPhone'],
      where: {
        paymentStatus: PaymentStatus.COMPLETED,
        voterPhone: { not: null },
      },
      _count: { id: true },
      _sum: { amount: true },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });

    return topVoters.map((voter) => ({
      phone: voter.voterPhone,
      totalVotes: voter._count.id,
      totalSpent: voter._sum.amount || 0,
    }));
  }
}
