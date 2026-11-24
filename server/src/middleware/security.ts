import { Request, Response, NextFunction, RequestHandler } from "express";

export interface RateLimiterOptions {
  windowMs?: number; // Time window in milliseconds (default: 60,000 = 1 minute)
  max?: number; // Max requests per windowMs (default: 60)
  message?: string | object; // Response when limit exceeded
  statusCode?: number; // HTTP status code (default: 429)
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

/**
 * Standard machine-readable error codes for self-correcting headless AI agents.
 */
export const SecurityErrorCodes = {
  MISSING_REQUIRED_FIELDS: "MISSING_REQUIRED_FIELDS",
  INVALID_SUPPORT_VALUE: "INVALID_SUPPORT_VALUE",
  DEADLINE_EXPIRED: "DEADLINE_EXPIRED",
  EXPIRED_DEADLINE: "DEADLINE_EXPIRED",
  PROPOSAL_NOT_FOUND: "PROPOSAL_NOT_FOUND",
  PROPOSAL_NOT_ACTIVE: "PROPOSAL_NOT_ACTIVE",
  ALREADY_VOTED: "ALREADY_VOTED",
  AGENT_NOT_REGISTERED: "AGENT_NOT_REGISTERED",
  ADDRESS_ALREADY_VOTED: "ADDRESS_ALREADY_VOTED",
  STALE_NONCE: "STALE_NONCE",
  INVALID_SIGNER: "INVALID_SIGNER",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  BALLOT_ALREADY_QUEUED: "BALLOT_ALREADY_QUEUED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  MALFORMED_PAYLOAD: "MALFORMED_PAYLOAD",
} as const;

export interface SelfCorrectingErrorParams {
  error: string;
  code: string;
  retryHint: string;
  specUrl?: string;
  expectedNonce?: string;
  providedNonce?: string;
  expectedSigner?: string;
  recoveredSigner?: string | null;
  currentTimestamp?: number;
  providedDeadline?: string;
  proposalStatus?: string;
  proposalId?: string;
  tokenId?: string;
  address?: string;
  missingFields?: string[];
  [key: string]: any;
}

/**
 * Responds with a structured machine-readable error and actionable recovery hint for LLM agents.
 */
export function selfCorrectingError(
  res: Response,
  statusCode: number,
  params: SelfCorrectingErrorParams
): void {
  const { specUrl = "/api/v1/agent-spec", ...rest } = params;
  const payload = {
    specUrl,
    ...rest,
  };
  res.status(statusCode).json(payload);
}

/**
 * Creates an in-memory sliding/fixed window rate limiter.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RequestHandler & { reset: () => void } {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const statusCode = options.statusCode ?? 429;
  const defaultMessage = {
    error: "Too many requests, please try again later.",
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  };
  const message = options.message ?? defaultMessage;

  const keyGenerator =
    options.keyGenerator ??
    ((req: Request): string => {
      // Prevent header spoofing: only inspect X-Forwarded-For if Express trust proxy is enabled
      if (req.app?.get("trust proxy")) {
        const forwarded = req.headers["x-forwarded-for"];
        if (typeof forwarded === "string") {
          return forwarded.split(",")[0].trim();
        }
      }
      return req.ip || req.socket.remoteAddress || "127.0.0.1";
    });

  const hits = new Map<string, ClientRecord>();

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 60_000));

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (options.skip && options.skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    let record = hits.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.max(0, Math.ceil((record.resetTime - now) / 1000));

    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", resetSeconds);

    if (record.count > max) {
      res.setHeader("Retry-After", resetSeconds);
      const errBody =
        typeof message === "string"
          ? {
              error: message,
              code: SecurityErrorCodes.RATE_LIMIT_EXCEEDED,
              retryAfterSeconds: resetSeconds,
              retryHint: `Rate limit reached. Please wait ${resetSeconds}s before retrying.`,
              specUrl: "/api/v1/agent-spec",
            }
          : {
              code: SecurityErrorCodes.RATE_LIMIT_EXCEEDED,
              retryAfterSeconds: resetSeconds,
              retryHint: `Rate limit reached. Please wait ${resetSeconds}s before retrying.`,
              specUrl: "/api/v1/agent-spec",
              ...message,
            };
      res.status(statusCode).json(errBody);
      return;
    }

    next();
  };

  return Object.assign(middleware, {
    reset: () => {
      hits.clear();
    },
  });
}

export const rateLimiter = createRateLimiter;

/**
 * Pre-configured rate limiter for /api/v1/vote/submit (burst & DoS protection)
 */
export const voteSubmitRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: {
    error: "Vote submission rate limit exceeded. Please wait before submitting more votes.",
  },
});

/**
 * Pre-configured rate limiter for /api/v1/proposals
 */
export const proposalsRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: {
    error: "Proposal rate limit exceeded. Please wait before querying or creating proposals.",
  },
});

/**
 * Request sanitization utility to prevent prototype pollution and null-byte injection.
 */
function sanitizeString(str: string): string {
  // Strip null bytes and trim excess outer whitespace
  return str.replace(/\0/g, "").trim();
}

function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 12 || obj === null || typeof obj !== "object") {
    if (typeof obj === "string") {
      return sanitizeString(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  const cleanObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Prototype pollution prevention
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    cleanObj[key] = sanitizeObject(value, depth + 1);
  }
  return cleanObj;
}

/**
 * Express middleware for request sanitization.
 */
export function sanitizeRequest(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (req.body && typeof req.body === "object") {
        req.body = sanitizeObject(req.body);
      }
      if (req.query && typeof req.query === "object") {
        req.query = sanitizeObject(req.query);
      }
      if (req.params && typeof req.params === "object") {
        req.params = sanitizeObject(req.params);
      }
      next();
    } catch {
      selfCorrectingError(res, 400, {
        error: "Malformed request payload",
        code: SecurityErrorCodes.MALFORMED_PAYLOAD,
        retryHint: "Ensure the JSON request body is valid and properly formatted.",
      });
    }
  };
}

/**
 * Secure HTTP response headers middleware.
 */
export function securityHeaders(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  };
}

/**
 * Secret leak protection middleware.
 * Scans all outgoing HTTP response bodies and redacts the relayer private key
 * to guarantee that internal secrets can never be exposed in API payloads.
 */
export type SecretProvider =
  | string
  | undefined
  | Array<string | undefined>
  | (() => Array<string | undefined>);

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Institutional-grade Secret Leak Protection Middleware.
 * Scans all outgoing HTTP response bodies and redacts relayer private keys,
 * active hot wallet keys, and keystore passwords to prevent credential leakage.
 */
export function secretLeakGuard(secretOrProvider?: SecretProvider): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    let rawList: Array<string | undefined> = [];
    if (typeof secretOrProvider === "function") {
      try {
        rawList = secretOrProvider();
      } catch {
        rawList = [];
      }
    } else if (Array.isArray(secretOrProvider)) {
      rawList = secretOrProvider;
    } else if (typeof secretOrProvider === "string") {
      rawList = [secretOrProvider];
    }

    const secretSet = new Set<string>();
    for (const item of rawList) {
      if (!item || typeof item !== "string") continue;
      const trimmed = item.trim();
      // Minimum length check to avoid accidentally redacting short trivial strings
      if (trimmed.length < 8) continue;

      secretSet.add(trimmed);
      // For 32-byte Ethereum hex keys (0x + 64 hex chars), also redact bare 64-char form
      if (trimmed.startsWith("0x") && trimmed.length === 66) {
        secretSet.add(trimmed.slice(2));
      }
    }

    if (secretSet.size === 0) {
      return next();
    }

    const secretsToRedact = Array.from(secretSet);
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const redactString = (str: string): string => {
      let result = str;
      for (const secret of secretsToRedact) {
        const escaped = escapeRegExp(secret);
        const regex = new RegExp(escaped, "gi");
        result = result.replace(regex, "[REDACTED_SECRET_KEY]");
      }
      return result;
    };

    const redactPayload = (body: any): any => {
      if (typeof body === "string") {
        return redactString(body);
      }
      if (body && typeof body === "object") {
        try {
          const jsonStr = JSON.stringify(body);
          const cleanStr = redactString(jsonStr);
          return JSON.parse(cleanStr);
        } catch {
          return body;
        }
      }
      return body;
    };

    res.json = (body: any): Response => {
      return originalJson(redactPayload(body));
    };

    res.send = (body: any): Response => {
      return originalSend(redactPayload(body));
    };

    next();
  };
}
