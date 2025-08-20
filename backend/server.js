#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

class MyMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'my-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_system_info',
            description: 'Get basic system information',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'echo',
            description: 'Echo back the provided message',
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Message to echo back',
                },
              },
              required: ['message'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'get_system_info':
          return {
            content: [
              {
                type: 'text',
                text: `System: ${process.platform}\nNode.js: ${process.version}\nUptime: ${process.uptime()} seconds`,
              },
            ],
          };

        case 'echo':
          if (!args?.message) {
            throw new McpError(ErrorCode.InvalidParams, 'Missing message parameter');
          }
          return {
            content: [
              {
                type: 'text',
                text: `Echo: ${args.message}`,
              },
            ],
          };

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP server running on stdio');
  }
}

const server = new MyMCPServer();
server.run().catch(console.error);
