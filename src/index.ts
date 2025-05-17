import fs from 'fs';
import path from 'path';
import express from 'express';
import { startHealthCheckScheduler, checkServerHealth, setCheckInterval } from './healthChecker';
import { Server } from './types';

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, '../data/servers.json');
const START_TIME = new Date();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health endpoint
app.get('/health', (req, res) => {
  try {
    const uptime = Math.floor((new Date().getTime() - START_TIME.getTime()) / 1000);
    const data = readServersData();
    
    res.status(200).json({
      status: 'healthy',
      version: '1.0.0',
      uptime: `${uptime} seconds`,
      serverCount: data.servers.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check endpoint error:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Internal server error'
    });
  }
});

// Ensure data files exist function
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

// Call this function at startup
ensureDataFilesExist();

// Read servers data safely
function readServersData(): { servers: Server[] } {
  try {
    // Check if file exists again before attempting to read
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

// Write servers data safely
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

// API Routes
// Get all servers
app.get('/api/servers', (req, res) => {
  try {
    const { servers } = readServersData();
    res.json(servers);
  } catch (error) {
    console.error('Error reading servers:', error);
    res.status(500).json({ error: 'Failed to load servers' });
  }
});

// Get a specific server
app.get('/api/servers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { servers } = readServersData();
    
    const server = servers.find((s: Server) => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    res.json(server);
  } catch (error) {
    console.error('Error getting server:', error);
    res.status(500).json({ error: 'Failed to get server' });
  }
});

// Delete a server
app.delete('/api/servers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = readServersData();
    
    const serverIndex = data.servers.findIndex((s: Server) => s.id === id);
    
    if (serverIndex === -1) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    // Remove the server
    data.servers.splice(serverIndex, 1);
    writeServersData(data);
    
    res.status(200).json({ message: 'Server deleted successfully' });
  } catch (error) {
    console.error('Error deleting server:', error);
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// Add a new server
app.post('/api/servers', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const data = readServersData();
    
    // Check if server already exists
    if (data.servers.some((server: Server) => server.url === url)) {
      return res.status(400).json({ error: 'Server already exists' });
    }
    
    // Add new server with unknown status
    const newServer: Server = {
      id: Date.now().toString(),
      url,
      status: 'unknown',
      lastChecked: null
    };
    
    // Immediately perform health check on the new server
    try {
      const status = await checkServerHealth(newServer);
      newServer.status = status;
      newServer.lastChecked = new Date().toISOString();
    } catch (error) {
      console.error(`Initial health check failed for ${url}:`, error);
      // Keep default status if check fails
    }
    
    data.servers.push(newServer);
    writeServersData(data);
    
    res.status(201).json(newServer);
  } catch (error) {
    console.error('Error adding server:', error);
    res.status(500).json({ error: 'Failed to add server' });
  }
});

// Configuration endpoint
app.post('/api/config', (req, res) => {
  try {
    const { checkInterval } = req.body;
    
    if (checkInterval === undefined) {
      return res.status(400).json({ error: 'checkInterval is required' });
    }
    
    // Validate and update the check interval
    const success = setCheckInterval(checkInterval);
    
    if (!success) {
      return res.status(400).json({ error: 'Invalid check interval. Must be one of: 1, 5, 8, 10 minutes' });
    }
    
    res.status(200).json({ 
      message: `Check interval updated to ${checkInterval} minute(s)`,
      checkInterval
    });
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  // Start the health check scheduler
  console.log('Starting health check service...');
  startHealthCheckScheduler();
});