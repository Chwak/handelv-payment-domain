/**
 * Domain authorization by operation mode scope.
 * Aligns with auth-essentials: Cognito injects maker_enabled and collector_enabled
 * into the token; the authorizer exposes them in requestContext.authorizer.claims.
 *
 * Payment domain scope: both (collector and maker can use payments).
 */

export type OperationScope = 'maker' | 'collector' | 'both';

export interface AuthorizerClaims {
  sub?: string;
  maker_enabled?: string;
  collector_enabled?: string;
  [key: string]: unknown;
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

export function isAuthorizedForScope(
  claims: AuthorizerClaims | null | undefined,
  scope: OperationScope,
): boolean {
  if (!claims) return false;
  const makerEnabled = isEnabled(claims.maker_enabled);
  const collectorEnabled = isEnabled(claims.collector_enabled);

  switch (scope) {
    case 'maker':
      return makerEnabled;
    case 'collector':
      return collectorEnabled;
    case 'both':
      return makerEnabled || collectorEnabled;
    default:
      return false;
  }
}
