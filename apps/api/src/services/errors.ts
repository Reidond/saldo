// Business outcomes that the HTTP layer maps to status codes. Domain
// validation errors from @saldo/domain and zod pass through unchanged.

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super("Subscription not found");
  }
}

/** The signed-in identity may not use this instance (disabled or not owner). */
export class AccessDeniedError extends Error {
  constructor() {
    super("Access denied");
  }
}

/** The Access token predates the user's last sign-out. */
export class SessionEndedError extends Error {
  constructor() {
    super("Session ended");
  }
}

export class AiNotConnectedError extends Error {
  constructor() {
    super("AI provider is not connected");
  }
}

export class AiRequestFailedError extends Error {
  readonly rateLimited: boolean;
  constructor(rateLimited: boolean) {
    super("AI provider request failed");
    this.rateLimited = rateLimited;
  }
}
