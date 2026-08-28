import type { Role } from './tokens.js';

/** Role hierarchy — every role includes the permissions of the ones below it. */
const ROLE_LEVEL: Record<Role, number> = {
  user: 0,
  moderator: 1,
  editor: 2,
  admin: 3,
  super_admin: 4,
};

export function roleAtLeast(role: Role, required: Role): boolean {
  return (ROLE_LEVEL[role] ?? -1) >= ROLE_LEVEL[required];
}

export const ROLES: Role[] = ['user', 'moderator', 'editor', 'admin', 'super_admin'];
