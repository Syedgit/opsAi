import type { PrismaClient, UserRole } from '@prisma/client';
import { normalizeOwnerPhoneE164 } from '../storeOwnerOnboarding';

export type TeamRole = 'OWNER' | 'MANAGER' | 'STAFF';

export type WhatsAppPerson = {
  id: string;
  name: string | null;
  phoneE164: string;
  role: TeamRole;
};

export type DashboardMember = {
  userId: string;
  email: string;
  name: string | null;
  role: TeamRole;
};

export type StoreTeam = {
  whatsapp: WhatsAppPerson[];
  dashboard: DashboardMember[];
};

export type TeamActor = { userId: string; role: UserRole };

type TeamErr = { ok: false; status: number; error: string };
export type TeamResult = { ok: true } | TeamErr;

const ROLES: TeamRole[] = ['OWNER', 'MANAGER', 'STAFF'];

function asRole(value: unknown): TeamRole | null {
  return typeof value === 'string' && ROLES.includes(value as TeamRole) ? (value as TeamRole) : null;
}

function canAssign(actor: TeamActor, role: TeamRole): boolean {
  if (actor.role === 'OWNER') return true;
  if (actor.role === 'MANAGER') return role === 'STAFF' || role === 'MANAGER';
  return false;
}

function canTouchRole(actor: TeamActor, existing: TeamRole): boolean {
  return canAssign(actor, existing);
}

export async function loadStoreTeam(prisma: PrismaClient, storeId: string): Promise<StoreTeam> {
  const [whatsapp, memberships] = await Promise.all([
    prisma.userDirectory.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, phoneE164: true, role: true },
    }),
    prisma.userStore.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true, user: { select: { email: true, name: true } } },
    }),
  ]);
  return {
    whatsapp: whatsapp.map((p) => ({
      id: p.id,
      name: p.name,
      phoneE164: p.phoneE164,
      role: p.role as TeamRole,
    })),
    dashboard: memberships.flatMap((m) =>
      m.user?.email
        ? [{ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role as TeamRole }]
        : [],
    ),
  };
}

export async function addWhatsAppPerson(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
  input: { name?: string; phoneE164: string; role: unknown },
): Promise<TeamResult> {
  const role = asRole(input.role);
  if (!role) return { ok: false, status: 400, error: 'Role must be Owner, Manager, or Staff.' };
  if (!canAssign(actor, role)) return { ok: false, status: 403, error: 'Only an owner can add another owner.' };

  const phone = normalizeOwnerPhoneE164(input.phoneE164);
  if (!phone) {
    return { ok: false, status: 400, error: 'Invalid phone number. Use international format with country code, e.g. +15551234567' };
  }

  const taken = await prisma.userDirectory.findUnique({ where: { phoneE164: phone } });
  if (taken) {
    if (taken.storeId === storeId && taken.isActive) {
      return { ok: false, status: 409, error: 'That WhatsApp number is already on this store.' };
    }
    if (taken.isActive && taken.storeId && taken.storeId !== storeId) {
      return { ok: false, status: 409, error: 'That WhatsApp number is already registered to another store.' };
    }
    await prisma.userDirectory.update({
      where: { id: taken.id },
      data: {
        storeId,
        role,
        isActive: true,
        name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : taken.name,
      },
    });
    return { ok: true };
  }

  await prisma.userDirectory.create({
    data: {
      phoneE164: phone,
      storeId,
      role,
      isActive: true,
      name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : null,
    },
  });
  return { ok: true };
}

export async function updateWhatsAppPerson(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
  input: { id: string; name?: string; phoneE164?: string; role?: unknown },
): Promise<TeamResult> {
  const person = await prisma.userDirectory.findFirst({ where: { id: input.id, storeId, isActive: true } });
  if (!person) return { ok: false, status: 404, error: 'Person not found.' };
  if (!canTouchRole(actor, person.role as TeamRole)) {
    return { ok: false, status: 403, error: 'Only an owner can change another owner.' };
  }

  const data: { name?: string | null; phoneE164?: string; role?: TeamRole } = {};
  if (typeof input.name === 'string') data.name = input.name.trim().slice(0, 80) || null;
  if (input.role !== undefined) {
    const role = asRole(input.role);
    if (!role) return { ok: false, status: 400, error: 'Role must be Owner, Manager, or Staff.' };
    if (!canAssign(actor, role)) return { ok: false, status: 403, error: 'Only an owner can make someone an owner.' };
    if (person.role === 'OWNER' && role !== 'OWNER') {
      const owners = await prisma.userDirectory.count({ where: { storeId, isActive: true, role: 'OWNER' } });
      if (owners <= 1) return { ok: false, status: 409, error: 'Keep at least one owner on WhatsApp for this store.' };
    }
    data.role = role;
  }
  if (typeof input.phoneE164 === 'string' && input.phoneE164.trim()) {
    const phone = normalizeOwnerPhoneE164(input.phoneE164);
    if (!phone) {
      return { ok: false, status: 400, error: 'Invalid phone number. Use international format with country code, e.g. +15551234567' };
    }
    if (phone !== person.phoneE164) {
      const taken = await prisma.userDirectory.findUnique({ where: { phoneE164: phone } });
      if (taken && taken.id !== person.id) {
        return { ok: false, status: 409, error: 'That WhatsApp number is already registered.' };
      }
      data.phoneE164 = phone;
    }
  }
  await prisma.userDirectory.update({ where: { id: person.id }, data });
  return { ok: true };
}

export async function removeWhatsAppPerson(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
  id: string,
): Promise<TeamResult> {
  const person = await prisma.userDirectory.findFirst({ where: { id, storeId, isActive: true } });
  if (!person) return { ok: false, status: 404, error: 'Person not found.' };
  if (!canTouchRole(actor, person.role as TeamRole)) {
    return { ok: false, status: 403, error: 'Only an owner can remove another owner.' };
  }
  if (person.role === 'OWNER') {
    const owners = await prisma.userDirectory.count({ where: { storeId, isActive: true, role: 'OWNER' } });
    if (owners <= 1) return { ok: false, status: 409, error: 'Keep at least one owner on WhatsApp for this store.' };
  }
  await prisma.userDirectory.update({ where: { id: person.id }, data: { isActive: false } });
  return { ok: true };
}

export async function addDashboardMember(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
  input: { email: string; role: unknown },
): Promise<TeamResult> {
  const role = asRole(input.role);
  if (!role) return { ok: false, status: 400, error: 'Role must be Owner, Manager, or Staff.' };
  if (!canAssign(actor, role)) return { ok: false, status: 403, error: 'Only an owner can add another owner.' };

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'Enter the email they used to sign up.' };
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  if (!user?.isActive) {
    return { ok: false, status: 404, error: 'No account with that email. Ask them to sign up first, then add them here.' };
  }
  const existing = await prisma.userStore.findFirst({ where: { userId: user.id, storeId } });
  if (existing) {
    if (existing.role === role) return { ok: false, status: 409, error: 'They already have dashboard access to this store.' };
    if (!canTouchRole(actor, existing.role as TeamRole) || !canAssign(actor, role)) {
      return { ok: false, status: 403, error: 'Only an owner can change another owner.' };
    }
    await prisma.userStore.update({ where: { id: existing.id }, data: { role } });
    return { ok: true };
  }
  await prisma.userStore.create({ data: { userId: user.id, storeId, role } });
  return { ok: true };
}

export async function removeDashboardMember(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
  userId: string,
): Promise<TeamResult> {
  const membership = await prisma.userStore.findFirst({ where: { userId, storeId } });
  if (!membership) return { ok: false, status: 404, error: 'Person not found.' };
  if (!canTouchRole(actor, membership.role as TeamRole)) {
    return { ok: false, status: 403, error: 'Only an owner can remove another owner.' };
  }
  if (membership.userId === actor.userId) {
    return { ok: false, status: 409, error: 'You cannot remove your own dashboard login. Ask another owner.' };
  }
  if (membership.role === 'OWNER') {
    const owners = await prisma.userStore.count({ where: { storeId, role: 'OWNER' } });
    if (owners <= 1) return { ok: false, status: 409, error: 'Keep at least one owner who can open the dashboard.' };
  }
  await prisma.userStore.delete({ where: { id: membership.id } });
  return { ok: true };
}

export async function deactivateStore(
  prisma: PrismaClient,
  storeId: string,
  actor: TeamActor,
): Promise<TeamResult> {
  if (actor.role !== 'OWNER') {
    return { ok: false, status: 403, error: 'Only an owner can remove a store.' };
  }
  await prisma.storeConfig.update({ where: { storeId }, data: { active: false } });
  return { ok: true };
}
