/**
 * Barrel for the data layer. The implementation lives in ./hooks/* by domain
 * (this file was a single 2,800-line module with 200 exports); every existing
 * `import { ... } from "../api/hooks"` keeps working unchanged.
 */
export * from "./hooks/core";
export * from "./hooks/coverage";
export * from "./hooks/shorts";
export * from "./hooks/ops";
export * from "./hooks/trends";
export * from "./hooks/admin";
