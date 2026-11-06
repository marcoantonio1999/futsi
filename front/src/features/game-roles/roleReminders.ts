import { registerPlugin } from "@capacitor/core";

type ReminderRound = { id: number; number: number; ends: string };
type PermissionStatus = { enabled: boolean };

const bridge = (window as Window & { Capacitor?: { isPluginAvailable(name: string): boolean } }).Capacitor;
export const roleReminders = bridge?.isPluginAvailable("RoleReminders")
  ? registerPlugin<{
      status(): Promise<PermissionStatus>;
      enable(): Promise<PermissionStatus>;
      sync(input: { tournament: string; name: string; rounds: ReminderRound[] }): Promise<void>;
      shared(input: { key: string }): Promise<void>;
      clear(): Promise<void>;
    }>("RoleReminders")
  : null;
