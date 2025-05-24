import axios from 'axios';
import { Server, ServerStatus } from './types';

let CHECK_INTERVAL = 10 * 60 * 1000; // Fixed: 10 minutes in milliseconds
let checkIntervalTimer: NodeJS.Timeout;

// Import the async functions from index.ts
import { readServersData, writeServersData } from './index';

/**
 * Check the health of a single server
 */
export async function checkServerHealth(server: Server): Promise<ServerStatus> {
  try {
    const response = await axios.get(server.url, {
      timeout: 5000, // 5 second timeout
      validateStatus: () => true, // Don't throw on error status codes
    });
    
    // Consider 2xx status codes as healthy
    return response.status >= 200 && response.status < 300 ? 'healthy' : 'unhealthy';
  } catch (error) {
    console.error(`Health check failed for ${server.url}:`, error);
    return 'unhealthy';
  }
}

/**
 * Check the health of all servers
 */
async function checkAllServers(): Promise<void> {
  console.log('Running health checks...');
  const data = await readServersData();
  
  if (data.servers.length === 0) {
    console.log('No servers to check');
    return;
  }
  
  const now = new Date().toISOString();
  
  // Check each server's health in parallel
  const checkPromises = data.servers.map(async (server: Server) => {
    const status = await checkServerHealth(server);
    
    // Update server status
    server.status = status;
    server.lastChecked = now;
    
    console.log(`Server ${server.url} status: ${status}`);
    return server;
  });
  
  // Wait for all checks to complete
  const updatedServers = await Promise.all(checkPromises);
  
  // Update the data file
  data.servers = updatedServers;
  await writeServersData(data);
  
  console.log('Health checks completed');
}

/**
 * Start the health check scheduler
 */
export function startHealthCheckScheduler(): void {
  console.log('Starting health check scheduler...');
  
  // Run an initial check immediately
  checkAllServers();
  
  // Schedule regular checks with fixed 10 minute interval
  checkIntervalTimer = setInterval(() => {
    checkAllServers();
  }, CHECK_INTERVAL);
}