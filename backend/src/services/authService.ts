import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { prisma, withTransaction } from '../lib/prisma';
import { conflict, forbidden, invalidCredentials, notFound } from '../lib/errors';
import { SupabaseAuthClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { WalletService } from './walletService';
import { NotificationService } from './notificationService';
import { comparePassword, hashPassword, signAccessToken } from './tokenService';
import { toPublicUser, toWalletSummary, type PublicUser } from '../utils/serializers';

/** Roles a visitor may self-assign. ADMIN is provisioned only via seed/admin tooling. */
const SELF_REGISTERABLE_ROLES: Role[] = ['LEARNER', 'INSTRUCTOR'];

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  role?: Role;
  headline?: string;
  bio?: string;
  expertise?: string[];
}

export interface AuthResult {
  user: PublicUser & { wallet: ReturnType<typeof toWalletSummary> };
  accessToken: string;
  refreshToken?: string;
  expiresIn: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPasswordStrength(password: string): void {
  if (password.length < env.PASSWORD_MIN_LENGTH) {
    throw conflict(
      `Password must be at least ${env.PASSWORD_MIN_LENGTH} characters long.`,
      'VALIDATION_ERROR',
    );
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw conflict('Password must contain at least one letter and one number.', 'VALIDATION_ERROR');
  }
}

async function loadProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
  if (!user) throw notFound('User');
  return { ...toPublicUser(user), wallet: toWalletSummary(user.wallet) };
}

export const AuthService = {
  /**
   * Creates a Stake It profile.
   *
   * With `AUTH_PROVIDER=supabase` the credential is first created in Supabase
   * Auth; the local profile row then stores the Supabase subject id. With the
   * default `local` provider the password is hashed with bcrypt and this API
   * issues the session token itself.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const role = input.role && SELF_REGISTERABLE_ROLES.includes(input.role) ? input.role : 'LEARNER';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict('An account with this email already exists.', 'CONFLICT', { field: 'email' });

    let supabaseId: string | null = null;
    let providerSession: { accessToken: string; refreshToken?: string; expiresIn?: number } | null = null;
    let passwordHash: string | null = null;

    if (env.AUTH_PROVIDER === 'supabase') {
      const session = await SupabaseAuthClient.signUpWithPassword({
        email,
        password: input.password,
        metadata: { fullName: input.fullName, role },
      });
      supabaseId = session.userId;
      providerSession = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
      };
    } else {
      assertPasswordStrength(input.password);
      passwordHash = await hashPassword(input.password);
    }

    try {
      const created = await withTransaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            supabaseId,
            passwordHash,
            role,
            fullName: input.fullName.trim(),
            headline: input.headline?.trim() || null,
            bio: input.bio?.trim() || null,
            expertise: input.expertise ?? [],
          },
        });

        const wallet = await WalletService.getOrCreateWallet(tx, user.id);

        // Welcome grant so a new learner can immediately stake on a course.
        if (env.SIGNUP_WALLET_GRANT > 0) {
          await WalletService.credit(tx, {
            userId: user.id,
            amount: env.SIGNUP_WALLET_GRANT,
            type: 'SIGNUP_GRANT',
            description: `Welcome grant of ${env.SIGNUP_WALLET_GRANT} points`,
            referenceType: 'USER',
            referenceId: user.id,
          });
        }

        await NotificationService.notify(tx, {
          userId: user.id,
          type: 'SYSTEM',
          title: 'Welcome to Stake It',
          message: `Your accountability wallet was funded with ${env.SIGNUP_WALLET_GRANT} points. Stake them on a course to begin.`,
          link: '/courses',
        });

        return { user, wallet };
      });

      const profile = await loadProfile(created.user.id);

      if (providerSession) {
        return {
          user: profile,
          accessToken: providerSession.accessToken,
          refreshToken: providerSession.refreshToken,
          expiresIn: String(providerSession.expiresIn ?? 3600),
        };
      }

      const { accessToken, expiresIn } = signAccessToken({
        userId: created.user.id,
        email: created.user.email,
        role: created.user.role,
      });

      return { user: profile, accessToken, expiresIn };
    } catch (error) {
      // Best-effort compensation: never leave an orphaned Supabase credential
      // when the local profile could not be created.
      if (supabaseId) {
        logger.error({ err: error, supabaseId }, 'Rolling back orphaned Supabase user after profile failure');
      }
      throw error;
    }
  },

  async login(params: { email: string; password: string }): Promise<AuthResult> {
    const email = normalizeEmail(params.email);

    if (env.AUTH_PROVIDER === 'supabase') {
      const session = await SupabaseAuthClient.signInWithPassword({ email, password: params.password });
      const user = await prisma.user.findFirst({ where: { supabaseId: session.userId } });
      if (!user) {
        throw invalidCredentials(
          'No Stake It profile is linked to this account. Register on Stake It first.',
        );
      }
      if (!user.isActive) throw forbidden('This account has been deactivated. Contact an administrator.');

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      return {
        user: await loadProfile(user.id),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: String(session.expiresIn ?? 3600),
      };
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Identical error for unknown email and wrong password (no user enumeration).
    if (!user || !user.passwordHash) throw invalidCredentials();

    const valid = await comparePassword(params.password, user.passwordHash);
    if (!valid) throw invalidCredentials();
    if (!user.isActive) throw forbidden('This account has been deactivated. Contact an administrator.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const { accessToken, expiresIn } = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return { user: await loadProfile(user.id), accessToken, expiresIn };
  },

  async logout(accessToken: string | null): Promise<void> {
    if (env.AUTH_PROVIDER === 'supabase' && accessToken) {
      await SupabaseAuthClient.signOut(accessToken);
    }
    // Local tokens are stateless JWTs; the client discards them.
  },

  async getProfile(userId: string) {
    return loadProfile(userId);
  },

  async updateProfile(
    userId: string,
    input: { fullName?: string; headline?: string | null; bio?: string | null; avatarUrl?: string | null; expertise?: string[] },
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
        ...(input.headline !== undefined ? { headline: input.headline?.trim() || null } : {}),
        ...(input.bio !== undefined ? { bio: input.bio?.trim() || null } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
        ...(input.expertise !== undefined ? { expertise: input.expertise } : {}),
      },
    });
    return loadProfile(userId);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (env.AUTH_PROVIDER === 'supabase') {
      throw forbidden('Password changes are managed by Supabase for this deployment.');
    }
    assertPasswordStrength(newPassword);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User');

    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) throw invalidCredentials('Your current password is incorrect.');

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
  },
};
