# Server Health Monitor

A modern Node.js server application built with TypeScript and Express that monitors the health of server URLs. The application periodically checks the health of a list of server URLs, determines if each server is healthy or not, and provides a clean web interface to manage and view the monitored servers.

## Features

- **Health Check Monitoring**: Periodically checks the health of server URLs every 5 minutes
- **Web Interface**: Clean, responsive UI to add and view monitored servers
- **Data Persistence**: Stores server data in a JSON file
- **Real-time Status Updates**: Shows current health status of each server

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository or download the source code

2. Navigate to the project directory
   ```
   cd brk-healthy-status
   ```

3. Install dependencies
   ```
   npm install
   ```

## Running the Application

### Development Mode

To run the application in development mode with hot-reloading:

```
npm run dev
```

The server will start on http://localhost:3000 by default.

### Production Mode

To build and run the application in production mode:

1. Build the TypeScript code
   ```
   npm run build
   ```

2. Start the server
   ```
   npm start
   ```

## Usage

1. Open your browser and navigate to http://localhost:3000
2. Use the form at the top to add new server URLs for monitoring
3. View the list of monitored servers with their current health status
4. Remove servers from monitoring when no longer needed

## Configuration

- The default port is 3000. You can change it by setting the PORT environment variable
- Health checks run every 5 minutes by default. You can modify this interval in the `src/healthChecker.ts` file

## Project Structure

```
├── data/                  # Data storage directory
│   └── servers.json       # JSON file storing server data
├── dist/                  # Compiled JavaScript files
├── public/                # Static web assets
│   ├── index.html         # Main HTML page
│   ├── styles.css         # CSS styles
│   └── app.js             # Frontend JavaScript
├── src/                   # TypeScript source code
│   ├── index.ts           # Main application entry point
│   ├── healthChecker.ts   # Health check implementation
│   └── types.ts           # TypeScript type definitions
├── package.json           # Project dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

## Maintenance

### Adding New Features

To add new features to the application:

1. Modify the TypeScript files in the `src` directory
2. Update the frontend files in the `public` directory as needed
3. Rebuild the application using `npm run build`

### Troubleshooting

- If the application fails to start, check the console for error messages
- Verify that the `data` directory exists and is writable
- Ensure all dependencies are installed correctly

## License

ISC