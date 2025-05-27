import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';
import { startHealthCheckScheduler, checkServerHealth } from './healthChecker';
import { Server } from './types';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, '../data/servers.json');
const START_TIME = new Date();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health endpoint (for monitoring this service)
app.get('/health', (req: Request, res: Response) => {
  const uptime = Math.floor((Date.now() - START_TIME.getTime()) / 1000);
  res.json({
    status: 'healthy',
    uptime: `${uptime}s`,
    timestamp: new Date().toISOString()
  });
});

// Function to parse servers from environment variables
function parseServersFromEnv(): Server[] {
  const servers: Server[] = [];
  
  // Look for environment variables in the format:
  // SERVER_1_NAME=My Server
  // SERVER_1_URL=https://example.com
  // SERVER_2_NAME=Another Server
  // SERVER_2_URL=https://another.com
  
  let index = 1;
  while (true) {
    const nameKey = `SERVER_${index}_NAME`;
    const urlKey = `SERVER_${index}_URL`;
    
    const name = process.env[nameKey];
    const url = process.env[urlKey];
    
    if (!name || !url) {
      break; // No more servers defined
    }
    
    servers.push({
      id: `env_${index}`,
      name: name.trim(),
      url: url.trim(),
      status: 'unknown',
      lastChecked: null
    });
    
    index++;
  }
  
  console.log(`Loaded ${servers.length} servers from environment variables`);
  return servers;
}

// Ensure data files exist function
function ensureDataFilesExist() {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  if (!fs.existsSync(DATA_FILE)) {
    // Initialize with servers from environment variables
    const envServers = parseServersFromEnv();
    const initialData = { servers: envServers };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log(`Created servers.json file with ${envServers.length} servers from environment`);
  }
}

// Call this function at startup
ensureDataFilesExist();

// Read servers data
export async function readServersData(): Promise<{ servers: Server[] }> {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log("servers.json not found, recreating...");
      ensureDataFilesExist();
      return { servers: [] };
    }
    
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    // Always use environment servers as the source of truth
    const envServers = parseServersFromEnv();
    
    if (envServers.length > 0) {
      // Merge status from existing data with environment servers
      envServers.forEach(envServer => {
        const existingServer = parsed.servers?.find((s: Server) => s.url === envServer.url);
        if (existingServer) {
          envServer.status = existingServer.status;
          envServer.lastChecked = existingServer.lastChecked;
        }
      });
      
      return { servers: envServers };
    }
    
    return { servers: parsed.servers || [] };
  } catch (error) {
    console.error('Error reading servers data:', error);
    return { servers: [] };
  }
}

// Write servers data
export async function writeServersData(data: { servers: Server[] }): Promise<void> {
  try {
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing servers data:', error);
  }
}

// API Routes

// Get all servers (read-only)
app.get('/api/servers', async (req, res) => {
  try {
    const data = await readServersData();
    res.json(data.servers);
  } catch (error) {
    console.error('Error reading servers:', error);
    res.status(500).json({ error: 'Failed to load servers' });
  }
});

// Get a specific server (read-only)
app.get('/api/servers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readServersData();
    
    const server = data.servers.find((s: Server) => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    res.json(server);
  } catch (error) {
    console.error('Error getting server:', error);
    res.status(500).json({ error: 'Failed to get server' });
  }
});

// Manual health check endpoint
app.post('/api/check-health', async (req, res) => {
  try {
    console.log('Manual health check requested');
    const data = await readServersData();
    
    if (data.servers.length === 0) {
      return res.json({ message: 'No servers to check', servers: [] });
    }
    
    const now = new Date().toISOString();
    
    // Check each server's health in parallel
    const checkPromises = data.servers.map(async (server: Server) => {
      const status = await checkServerHealth(server);
      
      // Update server status
      server.status = status;
      server.lastChecked = now;
      
      console.log(`Manual check - Server ${server.name} (${server.url}) status: ${status}`);
      return server;
    });
    
    // Wait for all checks to complete
    const updatedServers = await Promise.all(checkPromises);
    
    // Update the data file
    data.servers = updatedServers;
    await writeServersData(data);
    
    console.log('Manual health checks completed');
    res.json({ message: 'Health checks completed', servers: updatedServers });
  } catch (error) {
    console.error('Error during manual health check:', error);
    res.status(500).json({ error: 'Failed to perform health checks' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  // Start the health check scheduler
  console.log('Starting health check service...');
  startHealthCheckScheduler();
});