import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Server, ServerStatus } from './types';

const DATA_FILE = path.join(__dirname, '../data/servers.json');
const CONFIG_FILE = path.join(__dirname, '../data/config.json');
let CHECK_INTERVAL = 5 * 60 * 1000; // Default: 5 minutes in milliseconds
let checkIntervalTimer: NodeJS.Timeout;

// Valid check intervals in minutes
const VALID_CHECK_INTERVALS = [1, 5, 8, 10];

/**
 * Ensure configuration files exist
 */
function ensureConfigFilesExist() {
  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ checkInterval: 5 }, null, 2));
    console.log(`Created config.json file: ${CONFIG_FILE}`);
  }
}

/**
 * Load configuration from file
 */
function loadConfig(): { checkInterval: number } {
  try {
    ensureConfigFilesExist();
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading config:', error);
    return { checkInterval: 5 }; // Default to 5 minutes
  }
}

/**
 * Save configuration to file
 */
function saveConfig(config: { checkInterval: number }): void {
  try {
    ensureConfigFilesExist();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Configuration saved: Check interval set to ${config.checkInterval} minutes`);
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

/**
 * Set check interval in minutes
 */
export function setCheckInterval(minutes: number): boolean {
  // Validate input
  if (!VALID_CHECK_INTERVALS.includes(minutes)) {
    console.error(`Invalid check interval: ${minutes}. Must be one of: ${VALID_CHECK_INTERVALS.join(', ')}`);
    return false;
  }

  // Convert to milliseconds
  CHECK_INTERVAL = minutes * 60 * 1000;
  
  // Save to config file
  saveConfig({ checkInterval: minutes });
  
  // Restart the interval timer
  if (checkIntervalTimer) {
    clearInterval(checkIntervalTimer);
  }
  checkIntervalTimer = setInterval(checkAllServers, CHECK_INTERVAL);
  
  console.log(`Check interval updated to ${minutes} minute(s) (${CHECK_INTERVAL}ms)`);
  return true;
}

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
  ensureConfigFilesExist();
  
  // Load configuration
  const config = loadConfig();
  setCheckInterval(config.checkInterval);
  
  // Run an initial check immediately
  checkAllServers();
  
  // Schedule regular checks (will be updated by setCheckInterval)
  checkIntervalTimer = setInterval(checkAllServers, CHECK_INTERVAL);
}