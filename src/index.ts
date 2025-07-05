import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express, { RequestHandler } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

const PORT = process.env.PORT || 3001;

// Map to store transports and their associated servers by session ID
const sessions: {
  [sessionId: string]: {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  };
} = {};

// Tool that provides text for summarization (but doesn't call createMessage)
const createSummarizeTool = (serverInstance: McpServer) => {
  serverInstance.registerTool(
    "summarize",
    {
      description: "Summarize any text using an LLM",
      inputSchema: {
        text: z.string().describe("Text to summarize"),
      },
    },
    async ({ text }) => {
      // Instead of calling createMessage (which creates circular dependency),
      // we'll return instructions for the client to handle
      return {
        content: [
          {
            type: "text",
            text: `Please summarize the following text:\n\n${text}`,
          },
        ],
      };
    }
  );
};

// Function to handle sampling requests from web interface
async function processSamplingRequest(
  text: string,
  sessionId?: string
): Promise<any> {
  // Find a server instance with sampling capabilities
  let samplingServer = null;

  if (sessionId && sessions[sessionId]) {
    // Use specific session if provided
    const session = sessions[sessionId];
    if (session.server && session.server.server) {
      const clientCapabilities = session.server.server.getClientCapabilities();
      if (clientCapabilities?.sampling) {
        samplingServer = session.server.server;
      }
    }
  } else {
    // Look through all active sessions to find one with sampling capabilities
    for (const session of Object.values(sessions)) {
      if (session.server && session.server.server) {
        const clientCapabilities =
          session.server.server.getClientCapabilities();
        if (clientCapabilities?.sampling) {
          samplingServer = session.server.server;
          break;
        }
      }
    }
  }

  if (!samplingServer) {
    throw new Error(
      "No client with sampling capabilities is currently connected"
    );
  }

  try {
    // Call the LLM through MCP sampling
    const response = await samplingServer.createMessage({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please summarize the following text concisely:\n\n${text}`,
          },
        },
      ],
      maxTokens: 500,
      modelPreferences: {
        costPriority: 0.5,
        intelligencePriority: 0.5,
        speedPriority: 0.5,
      },
    });

    return response;
  } catch (error) {
    console.error("Sampling error:", error);
    throw error;
  }
}

// Create an Express application
const app = express();

// Use JSON middleware to parse request bodies
app.use(express.json());

// Serve a simple HTML page for testing
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Sampling Server</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 800px; margin: 0 auto; }
        textarea { width: 100%; height: 200px; margin: 10px 0; }
        button { padding: 10px 20px; font-size: 16px; }
        .result { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        .error { background: #ffebee; color: #c62828; }
        .success { background: #e8f5e8; color: #2e7d32; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>MCP Sampling Server</h1>
        <p>This server provides MCP tools for summarization. Connect your MCP client to: <code>http://localhost:${PORT}/mcp</code></p>
        
        <h2>Test Sampling</h2>
        <textarea id="textInput" placeholder="Enter text to summarize..."></textarea>
        <br>
        <button onclick="summarize()">Summarize Text</button>
        <div id="result"></div>
      </div>
      
      <script>
        async function summarize() {
          const text = document.getElementById('textInput').value;
          const resultDiv = document.getElementById('result');
          
          if (!text.trim()) {
            resultDiv.innerHTML = '<div class="result error">Please enter some text to summarize.</div>';
            return;
          }
          
          resultDiv.innerHTML = '<div class="result">Processing...</div>';
          
          try {
            const response = await fetch('/api/summarize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: text })
            });
            
            const data = await response.json();
            
            if (data.success) {
              resultDiv.innerHTML = \`<div class="result success"><strong>Summary:</strong><br>\${data.result.content.text}</div>\`;
            } else {
              resultDiv.innerHTML = \`<div class="result error"><strong>Error:</strong> \${data.error}</div>\`;
            }
          } catch (error) {
            resultDiv.innerHTML = \`<div class="result error"><strong>Error:</strong> \${error.message}</div>\`;
          }
        }
      </script>
    </body>
    </html>
  `);
});

// API endpoint for summarization
app.post("/api/summarize", async (req, res) => {
  const { text, sessionId } = req.body;

  if (!text) {
    res.status(400).json({ error: "Missing text parameter" });
    return;
  }

  try {
    const result = await processSamplingRequest(text, sessionId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Summarization error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get active sessions
app.get("/api/sessions", (req, res) => {
  const sessionList = Object.entries(sessions).map(([sessionId, session]) => ({
    id: sessionId,
    capabilities: session.server?.server?.getClientCapabilities() || {},
  }));
  res.json({ sessions: sessionList });
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;
  let server: McpServer;

  if (sessionId && sessions[sessionId]) {
    // Reuse existing transport and server
    transport = sessions[sessionId].transport;
    server = sessions[sessionId].server;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request - create new server instance
    server = new McpServer(
      {
        name: "mcp-sampling",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          sampling: {}, // Enable sampling capability
        },
      }
    );

    // Register the tool on this server instance
    createSummarizeTool(server);

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport and server by session ID
        sessions[sessionId] = { transport, server };
        console.log(`Session initialized: ${sessionId}`);
      },
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up session when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        console.log(`Session closed: ${transport.sessionId}`);
        delete sessions[transport.sessionId];
      }
    };

    // Connect the server to the transport
    await server.connect(transport);
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  // Handle the request
  await transport.handleRequest(req, res, req.body);
});

const handleSessionRequest = async (
  req: express.Request,
  res: express.Response
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = sessions[sessionId].transport;
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

// Listen on the specified port
app.listen(PORT, () => {
  console.log(`Server is running on port http://localhost:${PORT}/mcp 🚀`);
  console.log(`Web interface available at: http://localhost:${PORT}`);
});
