document.addEventListener('DOMContentLoaded', () => {
  const serverForm = document.getElementById('add-server-form');
  const serverUrlInput = document.getElementById('server-url');
  const addErrorElement = document.getElementById('add-error');
  const serversContainer = document.getElementById('servers-container');
  const refreshTimeSelect = document.getElementById('refresh-time');
  const saveSettingsButton = document.getElementById('save-settings');
  const settingsMessage = document.getElementById('settings-message');
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
  
  // Default refresh interval in milliseconds (5 minutes)
  let refreshInterval = 5 * 60 * 1000;
  let refreshTimerId;

  // Load refresh time from localStorage
  if (localStorage.getItem('refreshTime')) {
    const savedTime = localStorage.getItem('refreshTime');
    refreshTimeSelect.value = savedTime;
    refreshInterval = parseInt(savedTime) * 60 * 1000; // Convert minutes to milliseconds
  }
  
  // Save and apply settings button click
  saveSettingsButton.addEventListener('click', async () => {
    const newRefreshTime = refreshTimeSelect.value;
    
    // Show loading state
    saveSettingsButton.disabled = true;
    saveSettingsButton.textContent = 'Applying...';
    
    try {
      // 1. First apply to server
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ checkInterval: parseInt(newRefreshTime) })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update server configuration');
      }
      
      // 2. Then save to localStorage
      localStorage.setItem('refreshTime', newRefreshTime);
      
      // 3. Update client-side refresh interval
      if (refreshTimerId) {
        clearInterval(refreshTimerId);
      }
      refreshInterval = parseInt(newRefreshTime) * 60 * 1000;
      refreshTimerId = setInterval(loadServers, refreshInterval);
      
      // Show success message
      settingsMessage.textContent = `Updated to ${newRefreshTime} minute${newRefreshTime === "1" ? "" : "s"} refresh`;
      settingsMessage.className = 'success-message';
      
      // Clear message after 3 seconds
      setTimeout(() => {
        settingsMessage.textContent = '';
      }, 3000);
      
    } catch (error) {
      // Show error message
      settingsMessage.textContent = error.message;
      settingsMessage.className = 'error-message';
    } finally {
      // Reset button state
      saveSettingsButton.disabled = false;
      saveSettingsButton.textContent = 'Save & Apply';
    }
  });

  // Load servers on page load
  loadServers();

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
      serverElement.className = 'server-item';
      
      // Determine status class
      let statusClass = 'status-unknown';
      if (server.status === 'healthy') {
        statusClass = 'status-healthy';
      } else if (server.status === 'unhealthy') {
        statusClass = 'status-unhealthy';
      }
      
      // Format last checked time
      let lastCheckedText = 'Never checked';
      if (server.lastChecked) {
        const date = new Date(server.lastChecked);
        lastCheckedText = `Last checked: ${date.toLocaleString()}`;
      }
      
      serverElement.innerHTML = `
        <div class="server-info">
          <a href="${server.url}" target="_blank" class="server-url" title="Open in new tab">${server.url}</a>
          <div class="server-status">
            <span class="status-indicator ${statusClass}"></span>
            ${server.status.charAt(0).toUpperCase() + server.status.slice(1)}
          </div>
          <div class="last-checked">${lastCheckedText}</div>
        </div>
        <div class="server-actions">
          <button class="remove" data-id="${server.id}">Remove</button>
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
      button.textContent = 'Removing...';
      
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
      button.textContent = 'Remove';
    }
  }

  // Set up auto-refresh with the configurable interval
  refreshTimerId = setInterval(loadServers, refreshInterval);
});