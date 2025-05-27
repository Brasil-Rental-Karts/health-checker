# Health Monitor

A simple and minimalist server health monitoring application built with Node.js, TypeScript, and Express. Monitor multiple servers and track their status with a clean, modern interface.

## Features

- 🚀 **Simple Setup** - No authentication required, just run and monitor
- 🔧 **Environment Configuration** - Configure servers via environment variables
- 📊 **Real-time Monitoring** - Automatic health checks every 10 minutes
- 🎨 **Minimalist UI** - Clean, responsive design
- 📱 **Mobile Friendly** - Works great on all devices
- ⚡ **Fast & Lightweight** - Built with performance in mind

## Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd health-checker
   npm install
   ```

2. **Configure your servers:**
   ```bash
   cp .env.example .env
   # Edit .env to add your servers
   ```

3. **Run the application:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to `http://localhost:3000`

## Configuration

### Environment Variables

Configure servers using environment variables in your `.env` file:

```env
# Port for the application
PORT=3000

# Server configuration
SERVER_1_NAME=Google
SERVER_1_URL=https://www.google.com

SERVER_2_NAME=GitHub
SERVER_2_URL=https://github.com

SERVER_3_NAME=My API
SERVER_3_URL=https://api.myservice.com/health
```

### Adding Servers

You can add servers in two ways:

1. **Environment Variables** (recommended for production):
   - Add `SERVER_X_NAME` and `SERVER_X_URL` to your `.env` file
   - Environment servers cannot be deleted through the UI
   - Perfect for permanent infrastructure monitoring

2. **Web Interface**:
   - Use the "Add Server" form in the web interface
   - These servers are stored locally and can be deleted
   - Great for temporary monitoring or testing

## API Endpoints

- `GET /health` - Application health check
- `GET /api/servers` - List all servers
- `POST /api/servers` - Add a new server
- `PUT /api/servers/:id` - Update a server
- `DELETE /api/servers/:id` - Delete a server

## Server Status

- 🟢 **Healthy** - Server responded with status 200-299
- 🔴 **Unhealthy** - Server responded with error or non-2xx status
- ⚪ **Unknown** - Server hasn't been checked yet

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Docker

```bash
# Build the image
docker build -t health-monitor .

# Run with environment variables
docker run -p 3000:3000 \
  -e SERVER_1_NAME="Google" \
  -e SERVER_1_URL="https://www.google.com" \
  health-monitor
```

## Docker Compose

```yaml
version: '3.8'
services:
  health-monitor:
    build: .
    ports:
      - "3000:3000"
    environment:
      - SERVER_1_NAME=Google
      - SERVER_1_URL=https://www.google.com
      - SERVER_2_NAME=GitHub
      - SERVER_2_URL=https://github.com
```

## Architecture

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: Vanilla JavaScript + Modern CSS
- **Storage**: Local JSON file (no database required)
- **Monitoring**: Configurable health check intervals

## License

ISC