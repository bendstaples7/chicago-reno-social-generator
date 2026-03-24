import type { LogSeverity } from './enums';

/** A single entry in the Activity Log */
export interface ActivityLogEntry {
  id: string;
  userId: string;
  component: string;
  operation: string;
  severity: LogSeverity;
  description: string;
  recommendedAction?: string;
  createdAt: Date;
}
