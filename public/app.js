document.addEventListener('DOMContentLoaded', () => {
  const serversContainer = document.getElementById('servers-container');
  const checkNowBtn = document.getElementById('check-now-btn');
  const lastUpdateText = document.getElementById('last-update-text');
  
  // Load servers on page load
  loadServers();
  
  // Set up auto-refresh every 10 minutes
  setInterval(loadServers, 10 * 60 * 1000);
  
  // Check now button functionality
  checkNowBtn.addEventListener('click', async () => {
    await performManualCheck();
  });

  // Function to perform manual health check
  async function performManualCheck() {
    try {
      // Disable button and show loading state
      checkNowBtn.disabled = true;
      
      // Show checking state in servers container
      serversContainer.innerHTML = '<div class="loading">Checking servers...</div>';
      
      const response = await fetch('/api/check-health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to check server health');
      }
      
      const result = await response.json();
      
      // Display updated servers
      displayServers(result.servers);
      
      // Update last check time
      updateLastCheckTime();
      
    } catch (error) {
      serversContainer.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    } finally {
      // Re-enable button
      checkNowBtn.disabled = false;
    }
  }

  // Function to load servers from API
  async function loadServers() {
    try {
      serversContainer.innerHTML = '<div class="loading">Loading servers...</div>';
      
      const response = await fetch('/api/servers');
      
      if (!response.ok) {
        throw new Error('Failed to load servers');
      }
      
      const servers = await response.json();
      
      displayServers(servers);
      updateLastCheckTime();
    } catch (error) {
      serversContainer.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    }
  }
  
  // Function to update last check time
  function updateLastCheckTime() {
    const now = new Date();
    lastUpdateText.textContent = `Last updated: ${now.toLocaleString()}`;
  }

  // Function to display servers in the UI
  function displayServers(servers) {
    if (!servers || servers.length === 0) {
      serversContainer.innerHTML = '<div class="no-servers">No servers configured</div>';
      return;
    }
    
    serversContainer.innerHTML = '';
    
    servers.forEach(server => {
      const serverCard = document.createElement('div');
      serverCard.className = 'server-card';
      
      // Determine status class
      let statusClass = 'status-unknown';
      let statusText = 'Unknown';
      
      if (server.status === 'healthy') {
        statusClass = 'status-healthy';
        statusText = 'Healthy';
      } else if (server.status === 'unhealthy') {
        statusClass = 'status-unhealthy';
        statusText = 'Unhealthy';
      }
      
      // Format last checked time
      let lastCheckedText = 'Never checked';
      if (server.lastChecked) {
        const date = new Date(server.lastChecked);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        
        if (diffMins < 1) {
          lastCheckedText = 'Just now';
        } else if (diffMins < 60) {
          lastCheckedText = `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
        } else if (diffMins < 1440) {
          const hours = Math.floor(diffMins / 60);
          lastCheckedText = `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else {
          lastCheckedText = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
      }
      
      serverCard.innerHTML = `
        <div class="server-header">
          <h3 class="server-name">${escapeHtml(server.name)}</h3>
          <div class="server-status ${statusClass}">
            <span class="status-dot"></span>
            ${statusText}
          </div>
        </div>
        <a href="${escapeHtml(server.url)}" target="_blank" class="server-url" title="Open in new tab">
          ${escapeHtml(server.url)}
        </a>
        <div class="server-footer">
          <span class="last-checked">${lastCheckedText}</span>
        </div>
      `;
      
      serversContainer.appendChild(serverCard);
    });
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});