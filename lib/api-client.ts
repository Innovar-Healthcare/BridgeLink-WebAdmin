/**
 * API client barrel — re-exports all domain modules.
 *
 * Consumers import from `@/lib/api-client` as before; the actual implementations
 * now live in separate domain modules for better navigability and maintainability.
 */

export * from "./api/api-core";
export * from "./api/api-auth";
export * from "./api/api-channels";
export * from "./api/api-messages";
export * from "./api/api-settings";
export * from "./api/api-users";
export * from "./api/api-alerts";
export * from "./api/api-extensions";
export * from "./api/api-dashboard";
export * from "./api/api-code-templates";
export * from "./api/api-lookups";
export * from "./api/api-ws";
export * from "./api/api-database";
