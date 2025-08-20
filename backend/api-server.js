#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session data
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
  }

  createSession(sessionId = null) {
    const id = sessionId || uuidv4();
    const session = {
      id: id,
      createdAt: new Date(),
      lastActivity: new Date(),
      messages: [],
      context: {
        currentUrl: null,
        lastScreenshot: null,
        browserState: 'closed',
        completedActions: []
      },
      locatorHistory: [],
      totalSteps: 0
    };
    
    this.sessions.set(id, session);
    this.scheduleCleanup(id);
    return session;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      return session;
    }
    return null;
  }

  updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = new Date();
      return session;
    }
    return null;
  }

  deleteSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  scheduleCleanup(sessionId) {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && Date.now() - session.lastActivity.getTime() > this.sessionTimeout) {
        console.log(`🗑️ Cleaning up expired session: ${sessionId}`);
        this.sessions.delete(sessionId);
      }
    }, this.sessionTimeout);
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      messageCount: session.messages.length,
      totalSteps: session.totalSteps,
      browserState: session.context.browserState,
      currentUrl: session.context.currentUrl
    }));
  }
}

class APIServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3001;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.mcpServers = {
      custom: null,
      playwright: null
    };
    this.availableTools = [];
    this.sessionManager = new SessionManager();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Create new session
    this.app.post('/api/session/create', (req, res) => {
      const session = this.sessionManager.createSession();
      console.log(`🆕 Created new session: ${session.id}`);
      res.json({ 
        sessionId: session.id,
        message: 'New automation session created'
      });
    });

    // Get session info
    this.app.get('/api/session/:sessionId', (req, res) => {
      const session = this.sessionManager.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      res.json({
        sessionId: session.id,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messages.length,
        totalSteps: session.totalSteps,
        context: session.context,
        recentLocators: session.locatorHistory.slice(-5) // Last 5 locators
      });
    });

    // List all sessions
    this.app.get('/api/sessions', (req, res) => {
      const sessions = this.sessionManager.getAllSessions();
      res.json({ sessions });
    });

    // Delete session
    this.app.delete('/api/session/:sessionId', (req, res) => {
      const deleted = this.sessionManager.deleteSession(req.params.sessionId);
      if (deleted) {
        console.log(`🗑️ Deleted session: ${req.params.sessionId}`);
        res.json({ message: 'Session deleted successfully' });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Main prompt processing endpoint with session support
    this.app.post('/api/prompt', async (req, res) => {
      try {
        const { prompt, sessionId, continueSession = false } = req.body;
        
        if (!prompt || !prompt.trim()) {
          return res.status(400).json({ error: 'Prompt is required' });
        }

        let session;
        if (sessionId && continueSession) {
          session = this.sessionManager.getSession(sessionId);
          if (!session) {
            return res.status(404).json({ error: 'Session not found' });
          }
          console.log(`🔄 Continuing session: ${sessionId}`);
        } else {
          session = this.sessionManager.createSession();
          console.log(`🆕 Starting new session: ${session.id}`);
        }

        console.log(`🎯 Processing prompt in session ${session.id}: ${prompt}`);
        
        // Process the prompt using the existing MCP client logic with session context
        const result = await this.processPromptWithMCP(prompt, session);
        
        // Update session with results
        this.sessionManager.updateSession(session.id, {
          locatorHistory: [...session.locatorHistory, ...result.locators],
          totalSteps: session.totalSteps + result.totalSteps,
          context: {
            ...session.context,
            ...result.context
          }
        });

        res.json({
          ...result,
          sessionId: session.id,
          canContinue: true,
          sessionInfo: {
            totalSteps: session.totalSteps + result.totalSteps,
            totalLocators: session.locatorHistory.length + result.locators.length,
            sessionAge: Date.now() - session.createdAt.getTime()
          }
        });
        
      } catch (error) {
        console.error('❌ Error processing prompt:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get available tools endpoint
    this.app.get('/api/tools', (req, res) => {
      res.json({ tools: this.availableTools });
    });

    // Get session conversation history
    this.app.get('/api/session/:sessionId/history', (req, res) => {
      const session = this.sessionManager.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      res.json({
        sessionId: session.id,
        messages: session.messages,
        locatorHistory: session.locatorHistory,
        context: session.context
      });
    });
  }

  // ... (keeping existing methods for MCP server management)
  async startMCPServers() {
    console.log('Starting MCP servers...');
    
    this.mcpServers.custom = spawn('node', ['server.js'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.mcpServers.playwright = spawn('npx', ['@executeautomation/playwright-mcp-server'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.initializeServer(this.mcpServers.custom, 'custom');
    await this.initializeServer(this.mcpServers.playwright, 'playwright');
    
    await this.discoverAllTools();
  }

  async initializeServer(server, serverName) {
    await this.sendMCPRequest(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        clientInfo: { name: `api-${serverName}-client`, version: '1.0.0' }
      }
    });

    await this.sendMCPNotification(server, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
  }

  async sendMCPRequest(server, request) {
    return new Promise((resolve, reject) => {
      const requestStr = JSON.stringify(request) + '\n';
      server.stdin.write(requestStr);
      
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout after 45 seconds'));
      }, 45000);
      
      let responseBuffer = '';
      
      const dataHandler = (data) => {
        responseBuffer += data.toString();
        const lines = responseBuffer.split('\n');
        
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                clearTimeout(timeout);
                server.stdout.removeListener('data', dataHandler);
                resolve(response);
                return;
              }
            } catch (error) {
              // Continue trying to parse
            }
          }
        }
        
        responseBuffer = lines[lines.length - 1];
      };
      
      server.stdout.on('data', dataHandler);
    });
  }

  async sendMCPNotification(server, notification) {
    const notificationStr = JSON.stringify(notification) + '\n';
    server.stdin.write(notificationStr);
  }

  async discoverAllTools() {
    console.log('Discovering tools from all servers...');
    
    try {
      const customTools = await this.sendMCPRequest(this.mcpServers.custom, {
        jsonrpc: '2.0', id: 2, method: 'tools/list'
      });

      const playwrightTools = await this.sendMCPRequest(this.mcpServers.playwright, {
        jsonrpc: '2.0', id: 3, method: 'tools/list'
      });

      this.availableTools = [
        ...customTools.result.tools.map(tool => ({
          ...tool, name: `custom_${tool.name}`, server: 'custom', originalName: tool.name
        })),
        ...playwrightTools.result.tools.map(tool => ({
          ...tool, name: `playwright_${tool.name}`, server: 'playwright', originalName: tool.name
        }))
      ];

      console.log('Available tools:');
      this.availableTools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
    } catch (error) {
      console.error('Error discovering tools:', error);
    }
  }

  extractLocatorInfo(toolName, toolArgs, toolResult) {
    const locatorInfo = {
      tool: toolName,
      timestamp: new Date().toISOString(),
      locator: null,
      action: null,
      element: null,
      success: true
    };

    if (toolName.includes('playwright_')) {
      const action = toolName.replace('playwright_', '');
      locatorInfo.action = action;

      if (toolArgs.selector) {
        locatorInfo.locator = toolArgs.selector;
      } else if (toolArgs.locator) {
        locatorInfo.locator = toolArgs.locator;
      } else if (toolArgs.text) {
        locatorInfo.locator = `text="${toolArgs.text}"`;
      } else if (toolArgs.role && toolArgs.name) {
        locatorInfo.locator = `role=${toolArgs.role}[name="${toolArgs.name}"]`;
      }

      if (toolResult && toolResult.content) {
        const textContent = toolResult.content.find(c => c.type === 'text')?.text || '';
        const elementMatch = textContent.match(/Found element[:\s]+(.+?)(?:\n|$)/i);
        if (elementMatch) {
          locatorInfo.element = elementMatch[1].trim();
        }
        
        if (textContent.includes('error') || textContent.includes('failed') || textContent.includes('not found')) {
          locatorInfo.success = false;
        }
      }
    }

    return locatorInfo;
  }

  async callTool(fullName, args = {}) {
    const tool = this.availableTools.find(t => t.name === fullName);
    if (!tool) {
      throw new Error(`Unknown tool: ${fullName}`);
    }

    const server = this.mcpServers[tool.server];
    const originalName = tool.originalName;
    
    if (!server) {
      throw new Error(`Unknown server: ${tool.server}`);
    }

    console.log(`🔧 Executing tool: ${originalName}`);
    
    try {
      const response = await this.sendMCPRequest(server, {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: originalName, arguments: args }
      });

      if (response.result) {
        return response.result;
      } else if (response.error) {
        throw new Error(response.error.message || 'Tool execution failed');
      } else {
        return { content: [{ type: 'text', text: 'Tool executed successfully' }] };
      }
    } catch (error) {
      console.log(`❌ Tool execution failed: ${error.message}`);
      throw error;
    }
  }

  async processPromptWithMCP(message, session) {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const tools = this.availableTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema
        }));

        // Enhanced system prompt with session context awareness
        const systemPrompt = `You are an intelligent browser automation assistant with session continuity capabilities.

SESSION CONTEXT AWARENESS:
${session.messages.length > 0 ? `
- This is a CONTINUING session (ID: ${session.id})
- Previous conversation history is available
- Current context: ${JSON.stringify(session.context)}
- Actions completed so far: ${session.totalSteps}
- Browser state: ${session.context.browserState}
- Current URL: ${session.context.currentUrl || 'None'}
- Recent locators used: ${session.locatorHistory.slice(-3).map(l => l.locator).join(', ')}

IMPORTANT: Build upon the previous conversation. Don't repeat completed actions unless specifically asked.
Ask clarifying questions about what the user wants to do next if the prompt is ambiguous.
` : `
- This is a NEW session (ID: ${session.id})
- No previous context available
- Start fresh with the automation task
`}

CORE PRINCIPLES:
- Use your eyes first: Always take screenshots to understand current state
- Think dynamically: Analyze the page structure and adapt your approach
- Be persistent: If something doesn't work, observe and try alternatives
- Session continuity: Remember what's been done and build upon it

You have access to Playwright MCP tools for browser automation. Use them intelligently based on what you observe and the session context.`;

        // Build messages array with session history
        let messages = [...session.messages];
        
        // Add the new user message
        messages.push({
          role: 'user',
          content: message
        });

        let conversationComplete = false;
        let maxIterations = 20;
        let iteration = 0;
        let finalResult = '';
        let locatorHistory = [];
        let contextUpdates = {};

        while (!conversationComplete && iteration < maxIterations) {
          iteration++;
          console.log(`\n🔄 Automation step ${iteration}...`);
          
          const response = await this.anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2048,
            system: systemPrompt,
            tools: tools,
            messages: messages
          });

          const responseText = response.content
            .filter(content => content.type === 'text')
            .map(content => content.text)
            .join('\n');
          
          if (responseText) {
            finalResult += (finalResult ? '\n\n' : '') + responseText;
          }

          messages.push({
            role: 'assistant',
            content: response.content
          });

          const toolUses = response.content.filter(content => content.type === 'tool_use');
          
          if (toolUses.length > 0) {
            console.log(`🔧 Claude is executing ${toolUses.length} tool(s)...`);
            
            const toolResults = [];
            
            for (const toolUse of toolUses) {
              try {
                console.log(`\n🛠️  Executing: ${toolUse.name}`);
                const result = await this.callTool(toolUse.name, toolUse.input);
                
                // Extract locator information
                const locatorInfo = this.extractLocatorInfo(toolUse.name, toolUse.input, result);
                if (locatorInfo.locator) {
                  locatorHistory.push(locatorInfo);
                }
                
                // Update context based on tool results
                if (toolUse.name === 'playwright_playwright_navigate' && toolUse.input.url) {
                  contextUpdates.currentUrl = toolUse.input.url;
                  contextUpdates.browserState = 'open';
                }
                
                if (toolUse.name === 'playwright_playwright_screenshot') {
                  contextUpdates.lastScreenshot = new Date().toISOString();
                }
                
                let toolContent;
                if (result && result.content) {
                  toolContent = result.content;
                } else if (result) {
                  toolContent = [{ type: 'text', text: JSON.stringify(result) }];
                } else {
                  toolContent = [{ type: 'text', text: 'Tool executed successfully' }];
                }
                
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: toolContent
                });
                
                console.log(`✅ Tool completed: ${toolUse.name}`);
                
              } catch (error) {
                console.log(`❌ Tool error: ${error.message}`);
                
                const locatorInfo = this.extractLocatorInfo(toolUse.name, toolUse.input, null);
                locatorInfo.success = false;
                if (locatorInfo.locator) {
                  locatorHistory.push(locatorInfo);
                }
                
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: [{ type: 'text', text: `Error: ${error.message}. Please try alternative approaches or selectors.` }],
                  is_error: true
                });
              }
            }

            messages.push({
              role: 'user',
              content: toolResults
            });

          } else {
            console.log('🎯 Claude completed the automation task');
            conversationComplete = true;
          }
        }

        // Update session messages
        session.messages = messages;

        return {
          response: finalResult || 'Task completed successfully',
          locators: locatorHistory,
          totalSteps: iteration,
          context: contextUpdates,
          success: true
        };
        
      } catch (error) {
        retryCount++;
        
        if (error.status === 529) {
          console.log(`🔄 API overloaded, retrying in ${retryCount * 2} seconds... (${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
          continue;
        }
        
        if (retryCount >= maxRetries) {
          console.error('❌ Max retries reached. Claude API Error:', error.message);
          throw error;
        }
        
        console.log(`🔄 Retrying due to error: ${error.message} (${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async cleanup() {
    console.log('Cleaning up MCP servers...');
    Object.values(this.mcpServers).forEach(server => {
      if (server) server.kill();
    });
  }

  async start() {
    try {
      await this.startMCPServers();
      
      this.app.listen(this.port, () => {
        console.log(`\n🚀 API Server running on http://localhost:${this.port}`);
        console.log(`📡 Frontend can now connect to: http://localhost:${this.port}/api/prompt`);
        console.log(`🔧 Available endpoints:`);
        console.log(`   GET  /health - Health check`);
        console.log(`   POST /api/prompt - Process prompts (with session support)`);
        console.log(`   POST /api/session/create - Create new session`);
        console.log(`   GET  /api/session/:id - Get session info`);
        console.log(`   GET  /api/sessions - List all sessions`);
        console.log(`   DELETE /api/session/:id - Delete session`);
        console.log(`   GET  /api/tools - List available tools`);
      });

      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down server...');
        await this.cleanup();
        process.exit(0);
      });

    } catch (error) {
      console.error('Error starting server:', error);
      await this.cleanup();
    }
  }
}

const apiServer = new APIServer();
apiServer.start();