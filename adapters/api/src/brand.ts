declare const brand: unique symbol;

/**
 * A nominal type. `Brand<string, 'UserId'>` is still a string at runtime, but
 * the compiler refuses a `ConnectionId` where a `UserId` belongs.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
