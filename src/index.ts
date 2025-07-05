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

// Tool that provides text for summarization using createMessage when available
const createSummarizeTool = (serverInstance: McpServer) => {
  serverInstance.registerTool(
    "summarize",
    {
      description: "Summarize any text using an LLM",
      inputSchema: {
        text: z.string().describe("Text to summarize"),
      },
    },
    // Handler with context for sessionId
    async function ({ text }, context) {
      // Ver lo que hay dentro del contexto
      console.log("[TOOL] Context received in summarize tool:", context);
      console.log("[TOOL] summarize called with text:", text);

      let currentSessionId = null;
      if (context && context.sessionId) {
        currentSessionId = context.sessionId;
        console.log("[TOOL] Got sessionId from context:", currentSessionId);
      }
      if (currentSessionId) {
        console.log("[TOOL] Using session for summarize:", currentSessionId);
        try {
          const response = await processSamplingRequest(text, currentSessionId);
          console.log("[TOOL] summarize response from sampling:", response);
          let summaryText = "";
          if (response && response.content) {
            if (typeof response.content === "string") {
              summaryText = response.content;
            } else if (response.content.text) {
              summaryText = response.content.text;
            } else if (
              Array.isArray(response.content) &&
              response.content.length > 0
            ) {
              summaryText =
                response.content[0].text || response.content[0].content || "";
            }
          }
          return {
            content: [
              {
                type: "text",
                text: summaryText || "Summary could not be generated",
              },
            ],
          };
        } catch (error) {
          console.error("[TOOL] Sampling error in tool:", error);
          return {
            content: [
              {
                type: "text",
                text: `Unable to generate summary due to error`,
              },
            ],
            isError: true,
          };
        }
      } else {
        // Always return a valid object, never undefined
        return {
          content: [
            {
              type: "text",
              text: "No valid session found for summarization.",
            },
          ],
          isError: true,
        };
      }
    }
  );
};

// Function to handle sampling requests from web interface
async function processSamplingRequest(
  text: string,
  sessionId?: string
): Promise<any> {
  console.log("[API] processSamplingRequest called", { text, sessionId });
  // Find a server instance with sampling capabilities
  let samplingServer = null;
  let usedSessionId: string | undefined = undefined;
  let clientInfo: any = {};

  if (sessionId && sessions[sessionId]) {
    // Use specific session if provided
    const session = sessions[sessionId];
    if (session.server && session.server.server) {
      const clientCapabilities = session.server.server.getClientCapabilities();
      console.log("[API] Session capabilities:", clientCapabilities);

      if (clientCapabilities?.sampling) {
        samplingServer = session.server.server;
        usedSessionId = sessionId;
        clientInfo = {
          sessionId,
          capabilities: clientCapabilities,
          hasSampling: true,
        };
        console.log("[API] Found sampling server for session:", clientInfo);
      } else {
        console.warn(
          "[API] Session does not have sampling capabilities:",
          clientCapabilities
        );
      }
    } else {
      console.warn("[API] Session server not properly initialized");
    }
  } else {
    // Look through all active sessions to find one with sampling capabilities
    for (const [sid, session] of Object.entries(sessions)) {
      if (session.server && session.server.server) {
        const clientCapabilities =
          session.server.server.getClientCapabilities();
        console.log(
          `[API] Checking session ${sid} capabilities:`,
          clientCapabilities
        );

        if (clientCapabilities?.sampling) {
          samplingServer = session.server.server;
          usedSessionId = sid;
          clientInfo = {
            sessionId: sid,
            capabilities: clientCapabilities,
            hasSampling: true,
          };
          console.log("[API] Found sampling server in sessions:", clientInfo);
          break;
        }
      }
    }
  }

  if (!samplingServer) {
    console.error("[API] No client with sampling capabilities connected");
    throw new Error(
      "No client with sampling capabilities is currently connected"
    );
  }

  try {
    console.log(
      `[API] Sending sampling request to client`,
      JSON.stringify(clientInfo, null, 2)
    );

    // Add timeout wrapper to handle long-running requests
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Sampling request timed out after 30 seconds"));
      }, 30000); // 30 second timeout
    });

    // Call the LLM through MCP sampling with timeout
    const samplingPromise = samplingServer.createMessage({
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
        costPriority: 1,
        intelligencePriority: 0.5,
        speedPriority: 1,
      },
    });

    const response = await Promise.race([samplingPromise, timeoutPromise]);
    console.log(
      "[API] Sampling response from client",
      usedSessionId,
      ":",
      response
    );
    return response;
  } catch (error) {
    console.error(
      "[API] Sampling error from client",
      usedSessionId,
      ":",
      error
    );

    // Provide a more user-friendly error message
    if (error instanceof Error && error.message.includes("timeout")) {
      throw new Error(
        "The AI client is taking too long to respond. Please try again or check your connection."
      );
    }

    // For other MCP errors, provide context
    if (error && typeof error === "object" && "code" in error) {
      const errorMessage =
        "message" in error ? String(error.message) : "Unknown error";
      throw new Error(
        `MCP communication error (${error.code}): ${errorMessage}`
      );
    }

    throw error;
  }
}

// Create an Express application
const app = express();

// Use JSON middleware to parse request bodies
app.use(express.json());

// Serve a simple HTML page for testing
app.get("/", (req, res) => {
  console.log("[HTTP] GET /");
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
  console.log("[HTTP] POST /api/summarize", req.body);
  const { text, sessionId } = req.body;

  if (!text) {
    console.warn("[HTTP] /api/summarize missing text parameter");
    res.status(400).json({ error: "Missing text parameter" });
    return;
  }

  try {
    const result = await processSamplingRequest(text, sessionId);
    res.json({ success: true, result });
  } catch (error) {
    console.error("[HTTP] Summarization error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get active sessions
app.get("/api/sessions", (req, res) => {
  console.log("[HTTP] GET /api/sessions");
  const sessionList = Object.entries(sessions).map(([sessionId, session]) => ({
    id: sessionId,
    capabilities: session.server?.server?.getClientCapabilities() || {},
  }));
  res.json({ sessions: sessionList });
});

app.post("/mcp", async (req, res) => {
  console.log("[MCP] POST /mcp", { headers: req.headers, body: req.body });
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;
  let server: McpServer;

  if (sessionId && sessions[sessionId]) {
    // Print info about the client
    console.log("[MCP] MCP request received for existing session:", sessionId);

    // Reuse existing transport and server
    transport = sessions[sessionId].transport;
    server = sessions[sessionId].server;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // Print info about the client
    console.log("[MCP] New MCP initialization request received:", req.body);
    console.log("[MCP] Client capabilities:", req.body.params.capabilities);
    console.log("[MCP] Client tools:", req.body.params.tools);
    console.log("[MCP] Client version:", req.body.params.version);
    console.log("[MCP] Client name:", req.body.params.name);
    console.log("[MCP] Client session ID:", req.body.params.sessionId);

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
        console.log(`[MCP] Session initialized: ${sessionId}`);
      },
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up session when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        console.log(`[MCP] Session closed: ${transport.sessionId}`);
        delete sessions[transport.sessionId];
      }
    };

    // Connect the server to the transport
    await server.connect(transport);
  } else {
    // Invalid request
    console.warn("[MCP] Invalid request: No valid session ID provided");
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
  console.log("[MCP] Handling MCP request...");
  await transport.handleRequest(req, res, req.body);
  console.log("[MCP] MCP request handled.");
});

const handleSessionRequest = async (
  req: express.Request,
  res: express.Response
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  console.log(`[MCP] ${req.method} /mcp with sessionId:`, sessionId);
  if (!sessionId || !sessions[sessionId]) {
    console.warn("[MCP] Invalid or missing session ID");
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = sessions[sessionId].transport;
  await transport.handleRequest(req, res);
  console.log(`[MCP] ${req.method} /mcp handled for sessionId:`, sessionId);
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
