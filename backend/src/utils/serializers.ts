import type { InstructorBadge, User, Wallet } from '@prisma/client';

/** The only user shape ever returned by the API. `passwordHash` is never included. */
export interface PublicUser {
  id: string;
  email: string;
  role: User['role'];
  fullName: string;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  expertise: string[];
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    headline: user.headline,
    bio: user.bio,
    expertise: user.expertise,
    isActive: user.isActive,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function toWalletSummary(wallet: Wallet | null | undefined) {
  if (!wallet) {
    return {
      availableBalance: 0,
      lockedBalance: 0,
      totalBalance: 0,
      lifetimeEarned: 0,
      lifetimeStaked: 0,
      lifetimeForfeited: 0,
    };
  }
  return {
    availableBalance: wallet.availableBalance,
    lockedBalance: wallet.lockedBalance,
    totalBalance: wallet.availableBalance + wallet.lockedBalance,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeStaked: wallet.lifetimeStaked,
    lifetimeForfeited: wallet.lifetimeForfeited,
  };
}

export function toBadgeSummary(badges: InstructorBadge[]) {
  const active = badges.filter((badge) => badge.isActive);
  const rank = { GOLD: 3, SILVER: 2, BRONZE: 1, NONE: 0 } as const;
  const current = active.sort((a, b) => rank[b.tier] - rank[a.tier])[0] ?? null;

  return {
    tier: current?.tier ?? 'NONE',
    awardedAt: current?.awardedAt ?? null,
    metrics: (current?.metrics ?? {}) as Record<string, unknown>,
    history: badges.map((badge) => ({
      id: badge.id,
      tier: badge.tier,
      awardedAt: badge.awardedAt,
      isActive: badge.isActive,
      notes: badge.notes,
    })),
  };
}

/**
 * Structural shape of an instructor card source. Declared explicitly (rather
 * than as `User & ...`) so Prisma `select` projections can be passed directly.
 */
export interface InstructorCardSource {
  id: string;
  fullName: string;
  headline?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  expertise?: string[];
  badges?: InstructorBadge[];
  _count?: { coursesTaught: number };
}

/** Compact instructor card shown on course detail pages. */
export function toInstructorCard(instructor: InstructorCardSource) {
  return {
    id: instructor.id,
    fullName: instructor.fullName,
    headline: instructor.headline,
    bio: instructor.bio,
    avatarUrl: instructor.avatarUrl,
    expertise: instructor.expertise,
    badge: toBadgeSummary(instructor.badges ?? []).tier,
    courseCount: instructor._count?.coursesTaught ?? undefined,
  };
}
