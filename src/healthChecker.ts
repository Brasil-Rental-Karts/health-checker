import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Server, ServerStatus } from './types';

const DATA_FILE = path.join(__dirname, '../data/servers.json');
// Config file no longer needed with fixed interval
let CHECK_INTERVAL = 10 * 60 * 1000; // Fixed: 10 minutes in milliseconds
let checkIntervalTimer: NodeJS.Timeout;

// Configuration functions removed - using fixed 10 minute interval

// setCheckInterval function removed - using fixed 10 minute interval

/**
 * Ensure data files exist function
 */
function ensureDataFilesExist() {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ servers: [] }, null, 2));
    console.log(`Created servers.json file: ${DATA_FILE}`);
  }
}

/**
 * Read servers data from the JSON file
 */
function readServersData(): { servers: Server[] } {
  try {
    // Ensure file exists before reading
    if (!fs.existsSync(DATA_FILE)) {
      console.log("servers.json not found, recreating...");
      ensureDataFilesExist();
      return { servers: [] };
    }
    
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading servers data:', error);
    return { servers: [] };
  }
}

/**
 * Write servers data to the JSON file
 */
function writeServersData(data: { servers: Server[] }): void {
  try {
    // Ensure directory exists before writing
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing servers data:', error);
  }
}

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
  const data = readServersData();
  
  if (data.servers.length === 0) {
    console.log('No servers to check');
    return;
  }
  
  const now = new Date().toISOString();
  
  // Check each server's health in parallel
  const checkPromises = data.servers.map(async (server) => {
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
  writeServersData(data);
  
  console.log('Health checks completed');
}

/**
 * Start the health check scheduler
 */
export function startHealthCheckScheduler(): void {
  console.log('Starting health check scheduler...');
  
  // Make sure data files exist before starting
  ensureDataFilesExist();
  
  // Start with fixed 10 minute interval
  checkIntervalTimer = setInterval(checkAllServers, CHECK_INTERVAL);
  
  // Run an initial check immediately
  checkAllServers();
  
  // Schedule regular checks (will be updated by setCheckInterval)
  checkIntervalTimer = setInterval(checkAllServers, CHECK_INTERVAL);
}