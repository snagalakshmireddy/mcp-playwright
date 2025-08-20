import React, { useState, useEffect } from 'react';
import './PromptApp.css';

const PromptApp = () => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessionHistory, setSessionHistory] = useState(null);

  // Load available sessions on component mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/sessions');
      const data = await response.json();
      setAvailableSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  const createNewSession = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      setCurrentSession({ 
        id: data.sessionId, 
        isNew: true,
        createdAt: new Date(),
        messageCount: 0,
        totalSteps: 0
      });
      setResult(null);
      setError('');
      loadSessions();
      console.log('New session created:', data.sessionId);
    } catch (err) {
      setError(`Failed to create new session: ${err.message}`);
    }
  };

  const selectSession = async (sessionId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/session/${sessionId}`);
      const data = await response.json();
      setCurrentSession(data);
      setResult(null);
      setError('');
      console.log('Selected session:', sessionId);
    } catch (err) {
      setError(`Failed to load session: ${err.message}`);
    }
  };

  const deleteSession = async (sessionId) => {
    try {
      await fetch(`http://localhost:3001/api/session/${sessionId}`, {
        method: 'DELETE'
      });
      
      if (currentSession && currentSession.sessionId === sessionId) {
        setCurrentSession(null);
        setResult(null);
      }
      
      loadSessions();
      console.log('Session deleted:', sessionId);
    } catch (err) {
      setError(`Failed to delete session: ${err.message}`);
    }
  };

  const loadSessionHistory = async (sessionId) => {
    try {
      const response = await fetch(`http://localhost:3001/api/session/${sessionId}/history`);
      const data = await response.json();
      setSessionHistory(data);
      setShowSessionHistory(true);
    } catch (err) {
      setError(`Failed to load session history: ${err.message}`);
    }
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    
    setIsLoading(true);
    setError('');
    setResult(null);
    
    try {
      // Create new session if none exists
      if (!currentSession) {
        await createNewSession();
        // Wait a bit for session creation
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const requestBody = {
        prompt: prompt.trim(),
        sessionId: currentSession?.id,
        continueSession: currentSession && !currentSession.isNew
      };

      const apiResponse = await fetch('http://localhost:3001/api/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!apiResponse.ok) {
        throw new Error(`HTTP error! status: ${apiResponse.status}`);
      }

      const data = await apiResponse.json();
      console.log('Automation completed:', data);
      
      setResult(data);
      
      // Update current session info
      if (data.sessionId) {
        setCurrentSession(prev => ({
          ...prev,
          id: data.sessionId,
          isNew: false,
          messageCount: (prev?.messageCount || 0) + 1,
          totalSteps: data.sessionInfo?.totalSteps || 0,
          lastActivity: new Date()
        }));
      }
      
      setPrompt('');
      loadSessions(); // Refresh session list
      
    } catch (err) {
      console.error('Error:', err);
      setError(`Failed to connect to backend: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setPrompt('');
    setError('');
    setResult(null);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getActionIcon = (action) => {
    const iconMap = {
      'click': '👆', 'type': '⌨️', 'fill': '📝', 'press': '🔘',
      'screenshot': '📸', 'goto': '🌐', 'wait_for_element': '⏳',
      'scroll': '📜', 'hover': '🖱️', 'select': '🎯'
    };
    return iconMap[action] || '🔧';
  };

  const getStatusIcon = (success) => success ? '✅' : '❌';

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  const formatDuration = (startDate) => {
    const diffMs = Date.now() - new Date(startDate).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="container">
      <div className="content">
        <h1 className="title">Gherkin Automation Interface</h1>
        <p className="subtitle">
          Enter Gherkin scenarios or automation commands with session continuity.
          Press Ctrl+Enter to submit.
        </p>
        
        {/* Session Management Panel */}
        <div className="session-panel">
          <div className="session-controls">
            <h3>🎯 Session Management</h3>
            
            <div className="session-actions">
              <button 
                onClick={createNewSession}
                className="button session-button new"
                disabled={isLoading}
              >
                🆕 New Session
              </button>
              
              {currentSession && (
                <div className="current-session-info">
                  <span className="session-id">
                    📍 Current: {currentSession.id?.slice(0, 8)}...
                  </span>
                  <span className="session-stats">
                    {currentSession.messageCount || 0} msgs, {currentSession.totalSteps || 0} steps
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Available Sessions */}
          {availableSessions.length > 0 && (
            <div className="sessions-list">
              <h4>Available Sessions:</h4>
              <div className="sessions-grid">
                {availableSessions.map(session => (
                  <div 
                    key={session.id} 
                    className={`session-card ${currentSession?.id === session.id ? 'active' : ''}`}
                  >
                    <div className="session-header">
                      <span className="session-id-short">
                        {session.id.slice(0, 8)}...
                      </span>
                      <div className="session-actions-mini">
                        <button 
                          onClick={() => selectSession(session.id)}
                          className="button session-button select"
                          disabled={isLoading}
                        >
                          Select
                        </button>
                        <button 
                          onClick={() => loadSessionHistory(session.id)}
                          className="button session-button history"
                          disabled={isLoading}
                        >
                          📋
                        </button>
                        <button 
                          onClick={() => deleteSession(session.id)}
                          className="button session-button delete"
                          disabled={isLoading}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    
                    <div className="session-details">
                      <div className="session-stat">
                        <span>Created: {formatDuration(session.createdAt)}</span>
                      </div>
                      <div className="session-stat">
                        <span>Messages: {session.messageCount}</span>
                        <span>Steps: {session.totalSteps}</span>
                      </div>
                      {session.currentUrl && (
                        <div className="session-url">
                          🌐 {new URL(session.currentUrl).hostname}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Input Form */}
        <div className="form-container">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyPress}
            className="textarea"
            disabled={isLoading}
            rows={6}
            placeholder={
              currentSession 
                ? `Continue automation in session ${currentSession.id?.slice(0, 8)}... What would you like to do next?`
                : "Enter your Gherkin scenario or automation command here..."
            }
          />
          
          <div className="button-container">
            <button
              onClick={handleSubmit}
              disabled={isLoading || !prompt.trim()}
              className={`button submit-button ${isLoading || !prompt.trim() ? 'disabled' : ''}`}
            >
              {isLoading ? 'Processing...' : 
               currentSession ? '🔄 Continue Automation' : '🚀 Start Automation'}
            </button>
            
            <button
              onClick={handleClear}
              disabled={isLoading}
              className={`button clear-button ${isLoading ? 'disabled' : ''}`}
            >
              Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="error-container">
            <h2 className="error-header">❌ Error:</h2>
            <p className="error-text">{error}</p>
            <p className="error-hint">
              Make sure your backend is running with: <code>node api-server.js</code>
            </p>
          </div>
        )}

        {isLoading && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Claude is analyzing and automating your scenario...</p>
            {currentSession && (
              <div className="current-task">
                <p>
                  <strong>Session:</strong> {currentSession.id?.slice(0, 8)}...
                  {currentSession.messageCount > 0 && (
                    <span> (Continuing conversation)</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {!isLoading && !error && result && (
          <div className="results-container">
            <div className="success-container">
              <h2 className="success-header">✅ Automation Completed</h2>
              <p className="success-text">
                Task has been processed successfully in session <strong>{result.sessionId?.slice(0, 8)}...</strong>
              </p>
              
              <div className="execution-stats">
                <span className="stat">📊 {result.totalSteps} steps executed</span>
                <span className="stat">🎯 {result.locators?.length || 0} elements interacted</span>
                {result.sessionInfo && (
                  <>
                    <span className="stat">🔄 Total session steps: {result.sessionInfo.totalSteps}</span>
                    <span className="stat">📝 Total session locators: {result.sessionInfo.totalLocators}</span>
                  </>
                )}
              </div>

              {result.canContinue && (
                <div className="continue-hint">
                  💡 <strong>You can continue this conversation!</strong> 
                  Just type your next instruction above.
                </div>
              )}
            </div>

            {/* Locators section remains the same */}
            {result.locators && result.locators.length > 0 && (
              <div className="locators-container">
                <h3 className="locators-header">🎯 Element Locators Used</h3>
                <div className="locators-list">
                  {result.locators.map((locator, index) => (
                    <div key={index} className={`locator-item ${locator.success ? 'success' : 'error'}`}>
                      <div className="locator-header">
                        <span className="action-icon">{getActionIcon(locator.action)}</span>
                        <span className="action-name">{locator.action?.replace('_', ' ') || 'Unknown Action'}</span>
                        <span className="status-icon">{getStatusIcon(locator.success)}</span>
                      </div>
                      
                      {locator.locator && (
                        <div className="locator-details">
                          <div className="locator-selector">
                            <span className="label">Selector:</span>
                            <code className="selector-code">{locator.locator}</code>
                          </div>
                          
                          {locator.element && (
                            <div className="locator-element">
                              <span className="label">Element:</span>
                              <span className="element-description">{locator.element}</span>
                            </div>
                          )}
                          
                          <div className="locator-timestamp">
                            <span className="timestamp">{new Date(locator.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.response && (
              <div className="response-container">
                <h3 className="response-header">📝 Execution Details</h3>
                <pre className="response-text">{result.response}</pre>
              </div>
            )}
          </div>
        )}

        {/* Session History Modal */}
        {showSessionHistory && sessionHistory && (
          <div className="modal-overlay" onClick={() => setShowSessionHistory(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>📋 Session History</h3>
                <button 
                  onClick={() => setShowSessionHistory(false)}
                  className="button close-button"
                >
                  ✕
                </button>
              </div>
              
              <div className="modal-body">
                <div className="session-info">
                  <p><strong>Session ID:</strong> {sessionHistory.sessionId}</p>
                  <p><strong>Messages:</strong> {sessionHistory.messages.length}</p>
                  <p><strong>Locators:</strong> {sessionHistory.locatorHistory.length}</p>
                  <p><strong>Current URL:</strong> {sessionHistory.context.currentUrl || 'None'}</p>
                  <p><strong>Browser State:</strong> {sessionHistory.context.browserState || 'Unknown'}</p>
                </div>
                
                <div className="history-messages">
                  <h4>Recent Conversation:</h4>
                  <div className="messages-list">
                    {sessionHistory.messages.slice(-6).map((msg, index) => (
                      <div key={index} className={`message ${msg.role}`}>
                        <strong>{msg.role}:</strong> 
                        {typeof msg.content === 'string' ? msg.content : 
                         Array.isArray(msg.content) ? 
                           msg.content.filter(c => c.type === 'text').map(c => c.text).join(' ') :
                           JSON.stringify(msg.content)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptApp;