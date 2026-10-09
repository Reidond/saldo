import * as accounts from "./accounts";
import * as auditEvents from "./audit-events";
import * as reviews from "./reviews";
import * as subscriptions from "./subscriptions";
import * as userIdentities from "./user-identities";
import * as users from "./users";

/** Every repository function; the composition root hands these to services. */
export const repositories = {
  ...accounts,
  ...auditEvents,
  ...reviews,
  ...subscriptions,
  ...userIdentities,
  ...users,
};
export type Repositories = typeof repositories;
