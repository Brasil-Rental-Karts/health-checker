export type ServerStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface Server {
  id: string;
  url: string;
  status: ServerStatus;
  lastChecked: string | null;
}