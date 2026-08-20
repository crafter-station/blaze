import type { Engine } from "./types";

/**
 * Engines blaze can provision right now.
 *
 * Kept separate from `lib/provision/engines.ts` because that module is server-only — it
 * imports database drivers — while the create dialog and the landing page need this list
 * in the browser. Two places would drift; one shared constant, checked against the
 * provisioner by a test-shaped assertion below, does not.
 */
export const PROVISIONABLE: Engine[] = ["postgres", "mysql", "mariadb", "redis"];

export function isProvisionable(engine: Engine): boolean {
	return PROVISIONABLE.includes(engine);
}
