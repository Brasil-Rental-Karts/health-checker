export type ServerStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface Server {
  id: string;
  name: string;
  url: string;
  status: ServerStatus;
  lastChecked: string | null;
}

// Remove session interface since we're removing authentication