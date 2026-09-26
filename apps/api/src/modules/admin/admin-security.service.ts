import { type ActorContext, type SettingsService, writeAuditLog } from '@stormvpn/core';
import type { Database, Prisma, RiskSubjectType, Severity } from '@stormvpn/database';
import type {
  AdminSecurityEventDto,
  AuditLogDto,
  Paginated,
  RiskFlagDto,
  SecurityEventType,
  SystemSettingsDto,
} from '@stormvpn/types';
import type { SettingsUpdateInput } from '@stormvpn/validation';
import type { Clock } from '../../lib/clock';
import { notFound } from '../../lib/errors';
import { pageArgs, paginated } from '../../lib/pagination';

export class AdminSecurityService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async auditLogs(query: {
    page: number;
    pageSize: number;
    action?: string;
    actorId?: string;
    targetType?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
  }): Promise<Paginated<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to ? { createdAt: { gte: query.from, lte: query.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: { actor: { select: { email: true } } },
      }),
      this.db.auditLog.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        actorType: row.actorType,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async securityEvents(query: {
    page: number;
    pageSize: number;
    type?: SecurityEventType;
    severity?: Severity;
    userId?: string;
    unresolvedOnly?: boolean;
  }): Promise<Paginated<AdminSecurityEventDto>> {
    const where: Prisma.SecurityEventWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.unresolvedOnly ? { resolvedAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        include: { user: { select: { email: true } } },
      }),
      this.db.securityEvent.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: row.user?.email ?? null,
        type: row.type as SecurityEventType,
        severity: row.severity,
        ipAddress: row.ipAddress,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
      total,
      query,
    );
  }

  async resolveEvent(id: string, actor: ActorContext): Promise<void> {
    const result = await this.db.securityEvent.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: this.clock.now(), resolvedById: actor.actorId },
    });
    if (result.count === 0) throw notFound('Security event');
    await writeAuditLog(this.db, {
      ...actor,
      action: 'security_event.resolve',
      targetType: 'security_event',
      targetId: id,
    });
  }

  async riskFlags(): Promise<RiskFlagDto[]> {
    const flags = await this.db.riskFlag.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return flags.map((flag) => ({
      id: flag.id,
      subjectType: flag.subjectType,
      subjectValue: flag.subjectValue,
      reason: flag.reason,
      score: flag.score,
      source: flag.source,
      createdAt: flag.createdAt.toISOString(),
      expiresAt: flag.expiresAt?.toISOString() ?? null,
      resolvedAt: flag.resolvedAt?.toISOString() ?? null,
    }));
  }

  async createRiskFlag(
    input: {
      subjectType: RiskSubjectType;
      subjectValue: string;
      reason: string;
      score: number;
      expiresInHours?: number | null;
    },
    actor: ActorContext,
  ): Promise<void> {
    const userId =
      input.subjectType === 'USER'
        ? ((
            await this.db.user.findUnique({
              where: { id: input.subjectValue },
              select: { id: true },
            })
          )?.id ?? null)
        : null;
    if (input.subjectType === 'USER' && !userId) throw notFound('User');
    const flag = await this.db.riskFlag.create({
      data: {
        subjectType: input.subjectType,
        subjectValue: input.subjectValue,
        userId,
        reason: input.reason,
        score: input.score,
        source: 'ADMIN',
        expiresAt: input.expiresInHours
          ? new Date(this.clock.now().getTime() + input.expiresInHours * 3600_000)
          : null,
      },
    });
    await writeAuditLog(this.db, {
      ...actor,
      action: 'risk_flag.create',
      targetType: 'risk_flag',
      targetId: flag.id,
      metadata: input,
    });
  }

  async resolveRiskFlag(id: string, actor: ActorContext): Promise<void> {
    const result = await this.db.riskFlag.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: this.clock.now() },
    });
    if (result.count === 0) throw notFound('Risk flag');
    await writeAuditLog(this.db, {
      ...actor,
      action: 'risk_flag.resolve',
      targetType: 'risk_flag',
      targetId: id,
    });
  }

  getSettings(): Promise<SystemSettingsDto> {
    return this.settings.get();
  }

  async updateSettings(
    input: SettingsUpdateInput,
    actor: ActorContext,
  ): Promise<SystemSettingsDto> {
    const updated = await this.settings.update(input, actor.actorId);
    await writeAuditLog(this.db, {
      ...actor,
      action: 'settings.update',
      targetType: 'settings',
      metadata: input as Record<string, unknown>,
    });
    return updated;
  }
}
