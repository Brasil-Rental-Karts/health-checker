export type ServerStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface Server {
  id: string;
  url: string;
  status: ServerStatus;
  lastChecked: string | null;
}

// Add custom session interface to fix TypeScript errors
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
  }
}