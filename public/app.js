document.addEventListener('DOMContentLoaded', () => {
  const serverForm = document.getElementById('add-server-form');
  const serverUrlInput = document.getElementById('server-url');
  const addErrorElement = document.getElementById('add-error');
  const serversContainer = document.getElementById('servers-container');
  const logoutButton = document.getElementById('logout-btn');
  
  // Logout functionality
  logoutButton.addEventListener('click', async () => {
    try {
      logoutButton.disabled = true;
      logoutButton.textContent = 'Logging out...';
      
      const response = await fetch('/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        window.location.href = '/login.html';
      } else {
        console.error('Logout failed');
        logoutButton.disabled = false;
        logoutButton.textContent = 'Logout';
      }
    } catch (error) {
      console.error('Logout error:', error);
      logoutButton.disabled = false;
      logoutButton.textContent = 'Logout';
    }
  });
  
  // Fixed refresh interval in milliseconds (10 minutes)
  const refreshInterval = 10 * 60 * 1000;
  
  // Settings section has been removed - using fixed 10 minute interval

  // Load servers on page load
  loadServers();
  
  // Set up auto-refresh with fixed 10-minute interval
  setInterval(loadServers, refreshInterval);

  // Add server form submission
  serverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addErrorElement.textContent = '';
    
    const url = serverUrlInput.value.trim();
    
    try {
      // Show loading state on button
      const submitButton = serverForm.querySelector('button[type="submit"]');
      const originalText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Adding...';
      
      const response = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add server');
      }
      
      // Clear input and reload servers
      serverUrlInput.value = '';
      loadServers();
      
    } catch (error) {
      addErrorElement.textContent = error.message;
    } finally {
      // Reset button state
      const submitButton = serverForm.querySelector('button[type="submit"]');
      submitButton.disabled = false;
      submitButton.textContent = 'Add Server';
    }
  });

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
    } catch (error) {
      serversContainer.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    }
  }

  // Function to display servers in the UI
  function displayServers(servers) {
    if (!servers || servers.length === 0) {
      serversContainer.innerHTML = '<div class="no-servers">No servers added yet</div>';
      return;
    }
    
    serversContainer.innerHTML = '';
    
    servers.forEach(server => {
      const serverElement = document.createElement('div');
      
      // Determine status class and apply it to the card itself
      let statusClass = 'status-unknown';
      if (server.status === 'healthy') {
        statusClass = 'status-healthy';
      } else if (server.status === 'unhealthy') {
        statusClass = 'status-unhealthy';
      }
      
      // Add both server-item class and status class to the container
      serverElement.className = `server-item ${statusClass}`;
      
      // Format last checked time
      let lastCheckedText = 'Never checked';
      if (server.lastChecked) {
        const date = new Date(server.lastChecked);
        lastCheckedText = `${date.toLocaleString()}`;
      }
      
      serverElement.innerHTML = `
        <div class="server-info">
          <div class="server-status">
            <span class="status-indicator ${statusClass}"></span>
            <strong>${server.status.charAt(0).toUpperCase() + server.status.slice(1)}</strong>
          </div>
          <a href="${server.url}" target="_blank" class="server-url" title="Open in new tab">${server.url}</a>
          <div class="last-checked">
            <span class="last-checked-label">Last checked:</span>
            <span class="last-checked-time">${lastCheckedText}</span>
          </div>
        </div>
        <div class="server-actions">
          <button class="remove" data-id="${server.id}" title="Remover servidor">
            <svg class="trash-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      `;
      
      serversContainer.appendChild(serverElement);
    });
    
    // Add event listeners to remove buttons
    document.querySelectorAll('.remove').forEach(button => {
      button.addEventListener('click', removeServer);
    });
  }

  // Function to remove a server
  async function removeServer(e) {
    const serverId = e.target.getAttribute('data-id');
    const button = e.target;
    
    try {
      // Show loading state
      button.disabled = true;
      button.innerHTML = '<span>Removendo...</span>';
      button.style.width = 'auto';
      button.style.padding = '8px 12px';
      
      const response = await fetch(`/api/servers/${serverId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove server');
      }
      
      // Reload servers after successful removal
      loadServers();
    } catch (error) {
      alert(`Error: ${error.message}`);
      // Reset button state on error
      button.disabled = false;
      // Reset the button with the trash icon
      button.innerHTML = `
        <svg class="trash-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
    }
  }

  // Set up auto-refresh with the configurable interval
  setInterval(loadServers, refreshInterval);
});