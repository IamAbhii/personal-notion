// The capability table. Only `owner` exists in the product today, but the check is real code rather
// than a stub, so adding editor and viewer later is a data change (a different role string in
// workspace_members) and not a new enforcement layer.
import type { Role } from '../repo/context';

export const CAPABILITIES = ['workspace.read', 'workspace.write'] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ['workspace.read', 'workspace.write'],
  editor: ['workspace.read', 'workspace.write'],
  viewer: ['workspace.read'],
};

// True when the role may perform the capability.
export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

// The capability a request needs, decided by method: reads need workspace.read, anything that can
// mutate needs workspace.write. /sync is the only write path in the product, so this stays a
// one-line rule rather than a per-route table.
// Future: when sharing arrives, add per-page capabilities and resolve them from the target row.
export function requiredCapability(method: string): Capability {
  return method === 'GET' || method === 'HEAD' ? 'workspace.read' : 'workspace.write';
}
