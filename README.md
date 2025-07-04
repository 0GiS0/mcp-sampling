# MCP Sampling Server

A Model Context Protocol (MCP) server that demonstrates proper implementation of LLM sampling capabilities.

## Problem Solved

This project addresses the common timeout issues encountered when implementing MCP sampling. The key issue was a circular dependency: calling `createMessage` from within an MCP tool handler creates a situation where:

1. A client calls the MCP tool
2. The tool tries to call `createMessage` to ask the same client to generate a response
3. This creates a circular dependency that results in timeouts

## Solution

The solution implements two approaches:

### 1. Simple MCP Tool
The `summarize` tool now returns a prompt for the client to handle directly, avoiding the circular dependency:

```typescript
return {
  content: [
    {
      type: "text",
      text: `Please summarize the following text:\n\n${text}`,
    },
  ],
};
```

### 2. Web Interface with Proper Sampling
A web interface at `http://localhost:3001` allows proper sampling by:
- Handling sampling requests through HTTP endpoints
- Calling `createMessage` on the correct server instance
- Avoiding the circular dependency by separating the tool execution from the sampling request

## Usage

### Start the Server
```bash
npm install
npm run build
node build/index.js
```

### Use the MCP Tool (Recommended)
Connect your MCP client to `http://localhost:3001/mcp` and use the `summarize` tool.

**How it works now:**
- The tool returns a prompt asking you to summarize the text
- Your MCP client (like Claude Desktop, VSCode, etc.) handles the summarization
- No circular dependency issues - works reliably!

### Access the Web Interface (Alternative)
Open `http://localhost:3001` in your browser to test the sampling functionality directly.

**How the web interface works:**
- Uses HTTP endpoints to handle sampling requests
- Calls `createMessage` on the correct server instance
- Demonstrates proper sampling implementation for learning purposes

## Key Architecture Insights

1. **Separation of Concerns**: Keep tool execution separate from sampling requests
2. **Proper Session Management**: Each MCP session needs its own server instance
3. **Client Capability Detection**: Check for sampling capabilities before attempting to use them
4. **Error Handling**: Provide meaningful error messages when sampling isn't available

## Comparison with mcp-webcam

This implementation follows the same pattern as the successful `mcp-webcam` project:
- Web interface for interactive functionality
- HTTP endpoints for sampling requests
- Proper session management
- Capability detection and error handling

The key difference is that this project focuses on text summarization rather than webcam capture, but the architectural principles are the same.

## Testing

The server provides both:
- MCP tool functionality (for integration with MCP clients)
- Web interface functionality (for direct testing and sampling)

You can test the sampling by:
1. Opening the web interface at `http://localhost:3001`
2. Entering text in the textarea
3. Clicking "Summarize Text" to see the sampling in action

Para usar con Claude Desktop, añade la configuración del servidor:

En MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
En Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-low-level-server-streamable-http": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Debugging 🐞🔍

Como los servidores MCP se comunican por stdio, depurar puede ser complicado. Recomendamos usar el [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 🕵️‍♂️, disponible como script de npm:

```bash
npm run inspector
```

El Inspector te dará una URL 🌐 para acceder a herramientas de depuración en tu navegador.
