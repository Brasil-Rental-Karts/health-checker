import https from 'https';
import http from 'http';
import { URL } from 'url';
import { Server, ServerStatus } from './types';

let CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds
let checkIntervalTimer: NodeJS.Timeout;

// Import the async functions from index.ts
import { readServersData, writeServersData } from './index';

/**
 * Check the health of a single server
 */
export async function checkServerHealth(server: Server): Promise<ServerStatus> {
  return new Promise((resolve) => {
    let resolved = false;
    
    // Manual timeout to ensure we don't hang
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.error(`Health check timeout for ${server.url}`);
        resolve('unhealthy');
      }
    }, 15000);
    
    try {
      const url = new URL(server.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Health-Monitor/1.0'
        }
      };
      
      const req = client.request(options, (res) => {
        if (!resolved) {
          // Consider 2xx status codes as healthy
          const status = res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 'healthy' : 'unhealthy';
          res.on('data', () => {}); // Consume response data
          res.on('end', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              resolve(status);
            }
          });
        }
      });
      
      req.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          console.error(`Health check failed for ${server.url}:`, error.message);
          resolve('unhealthy');
        }
      });
      
      req.end();
    } catch (error) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        console.error(`Health check failed for ${server.url}:`, error);
        resolve('unhealthy');
      }
    }
  });
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
    
    console.log(`Server ${server.name} (${server.url}) status: ${status}`);
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