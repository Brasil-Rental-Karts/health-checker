import fs from 'fs';
import path from 'path';
import express from 'express';
import session from 'express-session';
import { startHealthCheckScheduler, checkServerHealth } from './healthChecker';
import { Server } from './types';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, '../data/servers.json');
const START_TIME = new Date();

// Get environment variables
const APP_PASSWORD = (process.env.APP_PASSWORD || 'securemonitor123').trim();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

// GitHub API configuration
const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  }
});

// Function to read data from GitHub Gist
async function readFromGist(): Promise<{ servers: Server[] }> {
  try {
    if (!GITHUB_TOKEN || !GIST_ID) {
      console.log('GitHub configuration not found, falling back to local file');
      return readServersData();
    }

    const response = await githubApi.get(`/gists/${GIST_ID}`);
    
    // Check if the gist exists and has our file
    if (!response.data.files || !response.data.files['servers.json']) {
      console.log('servers.json not found in gist, creating it');
      // Create the file in the gist
      await githubApi.patch(`/gists/${GIST_ID}`, {
        files: {
          'servers.json': {
            content: JSON.stringify({ servers: [] }, null, 2)
          }
        }
      });
      return { servers: [] };
    }

    const content = response.data.files['servers.json'].content;
    const parsedData = JSON.parse(content);
    
    // Ensure the data has the correct structure
    if (!parsedData.servers) {
      console.log('Invalid data structure in gist, initializing empty servers array');
      return { servers: [] };
    }

    return parsedData;
  } catch (error) {
    console.error('Error reading from Gist:', error);
    // Fallback to local file if Gist read fails
    return readServersData();
  }
}

// Function to write data to GitHub Gist
async function writeToGist(data: { servers: Server[] }): Promise<void> {
  try {
    if (!GITHUB_TOKEN || !GIST_ID) {
      console.log('GitHub configuration not found, falling back to local file');
      return writeServersData(data);
    }

    // Validate data structure before writing
    if (!data || !Array.isArray(data.servers)) {
      console.error('Invalid data structure, not writing to Gist');
      throw new Error('Invalid data structure');
    }

    // Try to update the gist
    await githubApi.patch(`/gists/${GIST_ID}`, {
      files: {
        'servers.json': {
          content: JSON.stringify(data, null, 2)
        }
      }
    });

    console.log('Successfully wrote data to Gist');
  } catch (error) {
    console.error('Error writing to Gist:', error);
    // Fallback to local file if Gist write fails
    await writeServersData(data);
  }
}

// Log the loaded password (for debugging)
console.log('Environment loaded. APP_PASSWORD length:', APP_PASSWORD.length);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: 'server-health-monitor-secret',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Set to false for local development
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Skip auth for health check and login endpoints
  if (req.path === '/health' || req.path === '/login' || req.path === '/login.html') {
    return next();
  }
  
  // Skip auth for API requests that have valid auth
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // If accessing the main page and not authenticated, redirect to login
  if (req.path === '/' || req.path === '/index.html') {
    return res.redirect('/login.html');
  }
  
  // For API requests without auth, return 401
  res.status(401).json({ error: 'Authentication required' });
};

// Apply auth middleware to all routes
app.use(requireAuth);

// Login route
app.post('/login', (req, res) => {
  const { password } = req.body;
  
  console.log('Login attempt - Received password:', password);
  console.log('Expected password:', APP_PASSWORD);
  console.log('Password match:', password === APP_PASSWORD);
  
  if (password === APP_PASSWORD) {
    if (req.session) {
      req.session.authenticated = true;
    }
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout route
app.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to logout' });
      } else {
        res.status(200).json({ success: true });
      }
    });
  } else {
    res.status(200).json({ success: true });
  }
});

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    const uptime = Math.floor((new Date().getTime() - START_TIME.getTime()) / 1000);
    const data = await readServersData();
    
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

// Modify readServersData to use Gist
async function readServersData(): Promise<{ servers: Server[] }> {
  try {
    if (GITHUB_TOKEN && GIST_ID) {
      return await readFromGist();
    }

    // Fallback to local file
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

// Modify writeServersData to use Gist
async function writeServersData(data: { servers: Server[] }): Promise<void> {
  try {
    if (GITHUB_TOKEN && GIST_ID) {
      await writeToGist(data);
      return;
    }

    // Fallback to local file
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing servers data:', error);
  }
}

// Modify API routes to be async
app.get('/api/servers', async (req, res) => {
  try {
    const data = await readServersData();
    res.json(data.servers);
  } catch (error) {
    console.error('Error reading servers:', error);
    res.status(500).json({ error: 'Failed to load servers' });
  }
});

// Get a specific server
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

// Delete a server
app.delete('/api/servers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readServersData();
    
    const serverIndex = data.servers.findIndex((s: Server) => s.id === id);
    
    if (serverIndex === -1) {
      return res.status(404).json({ error: 'Server not found' });
    }
    
    data.servers.splice(serverIndex, 1);
    await writeServersData(data);
    
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
    
    const data = await readServersData();
    
    if (data.servers.some((server: Server) => server.url === url)) {
      return res.status(400).json({ error: 'Server already exists' });
    }
    
    const newServer: Server = {
      id: Date.now().toString(),
      url,
      status: 'unknown',
      lastChecked: null
    };
    
    try {
      const status = await checkServerHealth(newServer);
      newServer.status = status;
      newServer.lastChecked = new Date().toISOString();
    } catch (error) {
      console.error(`Initial health check failed for ${url}:`, error);
    }
    
    data.servers.push(newServer);
    await writeServersData(data);
    
    res.status(201).json(newServer);
  } catch (error) {
    console.error('Error adding server:', error);
    res.status(500).json({ error: 'Failed to add server' });
  }
});

// Configuration endpoint removed - using fixed 10 minute interval

// Authentication check endpoint
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.status(200).json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  // Start the health check scheduler
  console.log('Starting health check service...');
  startHealthCheckScheduler();
});