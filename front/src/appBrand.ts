import type { User } from "./types";

export const isSoccerWa = import.meta.env.VITE_APP_BRAND === "soccerwa";

export function canUseSoccerWa(user: User): boolean {
  return ["admin", "owner", "dev", "site_coordinator"].includes(user.role)
    || (user.role === "collaborator" && user.section_permissions?.includes("veronica_only") === true);
}
