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
const PORT = process.env.PORT || 3000;  // Allow PORT to be configured via environment variable
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

// Add cache and retry configuration
let gistDataCache: { servers: Server[] } | null = null;
let lastGistFetch: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // Increased to 5 minutes cache
const RETRY_DELAY = 30 * 1000; // 30 seconds retry delay
const MAX_RETRIES = 3; // Maximum number of retry attempts

// Rate limiting configuration
const RATE_LIMIT_BUFFER = 10; // Keep 10 requests as buffer
let rateLimitRemaining = 5000; // GitHub's default rate limit
let rateLimitReset = 0;
let requestCount = 0;
const REQUEST_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const requestTimes: number[] = [];

// Request lock mechanism
let gistRequestInProgress: Promise<{ servers: Server[] }> | null = null;
let gistWriteInProgress: Promise<void> | null = null;

// Helper function to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to check if we should throttle requests
function shouldThrottle(): boolean {
  const now = Date.now();
  
  // Remove old requests from the window
  while (requestTimes.length > 0 && requestTimes[0] < now - REQUEST_WINDOW) {
    requestTimes.shift();
  }
  
  // More conservative buffer for rate limit
  const safetyBuffer = Math.max(RATE_LIMIT_BUFFER, Math.floor(rateLimitRemaining * 0.1)); // 10% of remaining or minimum buffer
  
  // If we're close to the rate limit, throttle
  if (rateLimitRemaining <= safetyBuffer) {
    console.log(`Throttling: Only ${rateLimitRemaining} requests remaining until reset (buffer: ${safetyBuffer})`);
    return true;
  }
  
  // If we've made too many requests in the window, throttle
  const hourlyLimit = Math.floor((rateLimitRemaining - safetyBuffer) / 6); // Allow roughly 1/6 of remaining requests per hour
  if (requestTimes.length >= hourlyLimit) {
    console.log(`Throttling: Made ${requestTimes.length} requests in the last hour (limit: ${hourlyLimit})`);
    return true;
  }
  
  return false;
}

// Function to track API request
function trackApiRequest() {
  const now = Date.now();
  requestTimes.push(now);
  requestCount++;
}

// Function to check rate limit from response and get reset time
function getRateLimitInfo(response: any): { remaining: number; resetTime: number; isRateLimit: boolean } {
  let remaining = 5000; // Default GitHub rate limit
  let resetTime = 0;
  let isRateLimit = false;
  
  if (response?.headers) {
    const headers = response.headers;
    remaining = parseInt(headers['x-ratelimit-remaining'] || '5000');
    resetTime = parseInt(headers['x-ratelimit-reset'] || '0') * 1000;
    const limit = headers['x-ratelimit-limit'];
    const used = headers['x-ratelimit-used'];
    
    // Check if this is a rate limit response
    if (response.status === 403 && response.data?.message?.includes('rate limit')) {
      isRateLimit = true;
    }
    
    console.log(`GitHub API Rate Limit Status:
      - Total Limit: ${limit}
      - Used: ${used}
      - Remaining: ${remaining}
      - Resets at: ${new Date(resetTime).toLocaleString()}
      - Current request count: ${requestCount}
      - Requests in last hour: ${requestTimes.length}
      - Is rate limited: ${isRateLimit}
    `);
  }
  
  return { remaining, resetTime, isRateLimit };
}

// Function to validate GitHub token and check scopes
async function validateGithubToken(): Promise<boolean> {
  try {
    const response = await githubApi.get('/user');
    
    // Check scopes from response headers
    const scopes = response.headers['x-oauth-scopes']?.split(', ') || [];
    const requiredScopes = ['gist'];
    
    const hasRequiredScopes = requiredScopes.every(scope => scopes.includes(scope));
    if (!hasRequiredScopes) {
      console.error('GitHub token is missing required scopes. Required:', requiredScopes, 'Current:', scopes);
      return false;
    }
    
    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        console.error('GitHub token is invalid or expired');
        return false;
      }
      if (error.response?.status === 403) {
        const message = error.response.data?.message || '';
        if (message.includes('rate limit')) {
          console.error('Rate limit exceeded during token validation');
          // Consider token valid but rate limited
          return true;
        }
        console.error('GitHub token has insufficient permissions');
        return false;
      }
    }
    console.error('Error validating GitHub token:', error);
    return false;
  }
}

// Function to read data from GitHub Gist with retry
async function readFromGist(retryCount = 0): Promise<{ servers: Server[] }> {
  // If there's already a request in progress, wait for it
  if (gistRequestInProgress) {
    console.log('Another Gist read request is in progress, waiting for it to complete...');
    return gistRequestInProgress;
  }

  try {
    // Create a new request promise
    gistRequestInProgress = (async () => {
      try {
        // Check cache first
        const now = Date.now();
        if (gistDataCache && (now - lastGistFetch) < CACHE_TTL) {
          console.log('Using cached Gist data');
          return gistDataCache;
        }

        if (!GITHUB_TOKEN || !GIST_ID) {
          console.log('GitHub configuration not found, falling back to local file');
          return readServersData();
        }

        // Check if we should throttle
        if (shouldThrottle()) {
          console.log('Request throttled, using cached data');
          if (gistDataCache) {
            return gistDataCache;
          }
          return readServersData();
        }

        // Validate token on first request
        if (retryCount === 0) {
          const isValid = await validateGithubToken();
          if (!isValid) {
            console.error('Invalid GitHub token or insufficient permissions, falling back to local file');
            return readServersData();
          }
        }

        console.log('Fetching fresh data from GitHub Gist');
        const response = await githubApi.get(`/gists/${GIST_ID}`);
        
        // Track the request and update rate limit info
        trackApiRequest();
        const { remaining, resetTime, isRateLimit } = getRateLimitInfo(response);
        rateLimitRemaining = remaining;
        rateLimitReset = resetTime;
        
        // Check if the gist exists and has our file
        if (!response.data.files || !response.data.files['servers.json']) {
          console.log('servers.json not found in gist, creating it');
          // Create the file in the gist
          const createResponse = await githubApi.patch(`/gists/${GIST_ID}`, {
            files: {
              'servers.json': {
                content: JSON.stringify({ servers: [] }, null, 2)
              }
            }
          });
          
          // Track the create request
          trackApiRequest();
          const createLimitInfo = getRateLimitInfo(createResponse);
          rateLimitRemaining = createLimitInfo.remaining;
          rateLimitReset = createLimitInfo.resetTime;
          
          gistDataCache = { servers: [] };
          lastGistFetch = now;
          return gistDataCache;
        }

        const content = response.data.files['servers.json'].content;
        const parsedData = JSON.parse(content);
        
        // Ensure the data has the correct structure
        if (!parsedData.servers) {
          console.log('Invalid data structure in gist, initializing empty servers array');
          parsedData.servers = [];
        }

        // Update cache
        gistDataCache = parsedData;
        lastGistFetch = now;
        return parsedData;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          
          // Update rate limit info from error response
          if (error.response) {
            const { remaining, resetTime, isRateLimit } = getRateLimitInfo(error.response);
            rateLimitRemaining = remaining;
            rateLimitReset = resetTime;
            
            // If it's a rate limit issue
            if (isRateLimit) {
              console.error('Rate limit reached, using cached data');
              if (gistDataCache) {
                return gistDataCache;
              }
              return readServersData();
            }
          }
          
          // If it's a permission issue
          if (status === 403) {
            console.error('GitHub API access forbidden - check if token has gist permissions');
            return readServersData();
          }

          // If server error and not exceeded max retries
          if ((status === 500 || status === 502 || status === 503 || status === 504) && retryCount < MAX_RETRIES) {
            console.log(`GitHub API error (${status}), retrying in 30 seconds... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await wait(RETRY_DELAY);
            // Clear the lock before retrying
            gistRequestInProgress = null;
            return readFromGist(retryCount + 1);
          }
        }
        
        console.error('Error reading from Gist:', error);
        // Fallback to local file if Gist read fails
        return readServersData();
      }
    })();

    return await gistRequestInProgress;
  } finally {
    // Clear the lock after the request is complete
    gistRequestInProgress = null;
  }
}

// Function to write data to GitHub Gist with retry
async function writeToGist(data: { servers: Server[] }, retryCount = 0): Promise<void> {
  // If there's already a write in progress, wait for it
  if (gistWriteInProgress) {
    console.log('Another Gist write request is in progress, waiting for it to complete...');
    return gistWriteInProgress;
  }

  try {
    // Create a new write promise
    gistWriteInProgress = (async () => {
      try {
        if (!GITHUB_TOKEN || !GIST_ID) {
          console.log('GitHub configuration not found, falling back to local file');
          return writeServersData(data);
        }

        // Check if we should throttle
        if (shouldThrottle()) {
          console.log('Write request throttled, falling back to local file');
          return writeServersData(data);
        }

        // Validate data structure before writing
        if (!data || !Array.isArray(data.servers)) {
          console.error('Invalid data structure, not writing to Gist');
          throw new Error('Invalid data structure');
        }

        // Update cache immediately
        gistDataCache = { ...data };
        lastGistFetch = Date.now();

        // Try to update the gist
        const response = await githubApi.patch(`/gists/${GIST_ID}`, {
          files: {
            'servers.json': {
              content: JSON.stringify(data, null, 2)
            }
          }
        });

        // Track the request and update rate limit info
        trackApiRequest();
        const { remaining, resetTime } = getRateLimitInfo(response);
        rateLimitRemaining = remaining;
        rateLimitReset = resetTime;

        console.log('Successfully wrote data to Gist');
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          
          // Update rate limit info from error response
          if (error.response) {
            const { remaining, resetTime } = getRateLimitInfo(error.response);
            rateLimitRemaining = remaining;
            rateLimitReset = resetTime;
          }
          
          // Check if it's a rate limit issue
          if (status === 403) {
            console.error('Rate limit or permission issue, saving to local file');
            await writeServersData(data);
            return;
          }

          // If server error and not exceeded max retries
          if ((status === 500 || status === 502 || status === 503 || status === 504) && retryCount < MAX_RETRIES) {
            console.log(`GitHub API error (${status}), retrying in 30 seconds... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await wait(RETRY_DELAY);
            // Clear the lock before retrying
            gistWriteInProgress = null;
            return writeToGist(data, retryCount + 1);
          }
        }
        
        console.error('Error writing to Gist:', error);
        // Fallback to local file if Gist write fails
        await writeServersData(data);
      }
    })();

    return await gistWriteInProgress;
  } finally {
    // Clear the lock after the write is complete
    gistWriteInProgress = null;
  }
}

// Log the loaded password (for debugging)
console.log('Environment loaded. APP_PASSWORD length:', APP_PASSWORD.length);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Middleware for parsing JSON and serving static files
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health endpoint - BEFORE any authentication
app.get('/health', async (req, res) => {
  // Set a timeout for the health check
  const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
  
  try {
    const uptime = Math.floor((new Date().getTime() - START_TIME.getTime()) / 1000);
    let serverCount = 0;
    
    // Create a promise that will reject after the timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timed out')), HEALTH_CHECK_TIMEOUT);
    });

    try {
      // Race between reading data and timeout
      const data = await Promise.race([
        readServersData(),
        timeoutPromise
      ]) as { servers: Server[] };
      serverCount = data.servers.length;
    } catch (error) {
      console.error('Error or timeout reading servers data during health check:', error);
      // If we have cached data, use it
      if (gistDataCache) {
        console.log('Using cached data for health check');
        serverCount = gistDataCache.servers.length;
      }
      // Continue with health check even if we can't read server data
    }
    
    res.status(200).json({
      status: 'healthy',
      version: '1.0.0',
      uptime: `${uptime} seconds`,
      serverCount,
      timestamp: new Date().toISOString(),
      dataSource: gistDataCache ? 'cache' : 'file'
    });
  } catch (error) {
    console.error('Health check endpoint error:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Session middleware
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

// Authentication middleware - AFTER health endpoint
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Public endpoints that don't require authentication
  const publicPaths = ['/health', '/login', '/login.html'];
  if (publicPaths.includes(req.path)) {
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

// Apply auth middleware to all routes AFTER the health endpoint
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
export async function readServersData(): Promise<{ servers: Server[] }> {
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
export async function writeServersData(data: { servers: Server[] }): Promise<void> {
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