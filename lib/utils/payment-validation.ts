/**
 * Validation helpers for Payment Domain API Gateway lambdas.
 */

export function validateId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

export function validateLimit(raw: unknown, defaultValue = 20, max = 100): number {
  if (raw == null) return defaultValue;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

type ActiveMode = 'maker' | 'collector';
type RequiredMode = ActiveMode | 'both';
const REQUIRED_ACTIVE_MODE: RequiredMode = 'collector';

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function resolveActiveMode(claims: Record<string, unknown> | undefined): ActiveMode | null {
  const rawMode = claims?.active_mode;
  if (rawMode === 'maker' || rawMode === 'collector') return rawMode;
  const makerEnabled = isEnabled(claims?.maker_enabled);
  const collectorEnabled = isEnabled(claims?.collector_enabled);
  if (makerEnabled !== collectorEnabled) return makerEnabled ? 'maker' : 'collector';
  if (makerEnabled && collectorEnabled) return 'collector';
  return null;
}

function isAuthorizedForMode(claims: Record<string, unknown> | undefined, required: RequiredMode): boolean {
  const activeMode = resolveActiveMode(claims);
  if (required === 'both') return activeMode !== null;
  return activeMode === required;
}

export function getUserIdFromApiGatewayEvent(event: {
  requestContext?: { authorizer?: { claims?: { sub?: string } } };
}): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  if (!isAuthorizedForMode(claims, REQUIRED_ACTIVE_MODE)) return null;
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (typeof sub === 'string' && sub.trim()) return sub.trim();
  return null;
}
