import type { Clock, IdGenerator } from "../services/ports";

export const systemClock: Clock = { now: () => new Date() };

export const randomIds: IdGenerator = { uuid: () => crypto.randomUUID() };
