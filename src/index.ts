import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import {
  CallToolResult,
  CreateMessageResultSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

const PORT = process.env.PORT || 3001;

// Map to store transports and their associated servers by session ID
const sessions: {
  [sessionId: string]: {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  };
} = {};

const createSummarizeTool = (serverInstance: McpServer) => {
  serverInstance.registerTool(
    "summarize",
    {
      description: "Summarize any text using an LLM",
      inputSchema: {
        text: z.string().describe("Text to summarize"),
      },
    },
    async function (
      { text },
      extra: RequestHandlerExtra<any, any>
    ): Promise<CallToolResult> {
      // 🛠️ Tool handler called
      console.log("🛠️ [TOOL] Context received in summarize tool:", extra);
      console.log("📝 [TOOL] summarize called with text:", text);

      const result = await extra.sendRequest(
        {
          method: "sampling/createMessage",
          params: {
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
              costPriority: 0.5, // Balance cost and performance
              intelligencePriority: 0.5, // Balance intelligence and performance
              speedPriority: 0.5, // Prioritize speed
            },
          },
        },
        CreateMessageResultSchema
      );
      const completion = result.content.text;

      // ✅ Summarization complete

      // Show the information related with the LLM call

      console.log(`🧠 LLM used for the client: ${result.model}`);
      console.log("✅ [TOOL] Summarization complete:", completion);

      return {
        content: [
          {
            type: "text",
            text: completion as string,
          },
        ],
      };
    }
  );
};

// Create an Express application
const app = express();

// Use JSON middleware to parse request bodies
app.use(express.json());

app.post("/mcp", async (req, res) => {
  console.log("📩 [MCP] POST /mcp", { headers: req.headers, body: req.body });
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;
  let server: McpServer;

  if (sessionId && sessions[sessionId]) {
    // ♻️ Reusing existing session
    console.log(
      "♻️ [MCP] MCP request received for existing session:",
      sessionId
    );

    transport = sessions[sessionId].transport;
    server = sessions[sessionId].server;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // 🚀 New session initialization
    console.log("🚀 [MCP] New MCP initialization request received:", req.body);
    console.log("🧑‍💻 [MCP] Client capabilities:", req.body.params.capabilities);
    console.log("🧰 [MCP] Client tools:", req.body.params.tools);
    console.log("🔢 [MCP] Client version:", req.body.params.version);
    console.log("🏷️ [MCP] Client name:", req.body.params.name);
    console.log("🆔 [MCP] Client session ID:", req.body.params.sessionId);

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

    // 🛠️ Register summarize tool
    console.log("🛠️ [MCP] Registering summarize tool...");
    createSummarizeTool(server);

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions[sessionId] = { transport, server };
        console.log(`🔗 [MCP] Session initialized: ${sessionId}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        console.log(`❌ [MCP] Session closed: ${transport.sessionId}`);
        delete sessions[transport.sessionId];
      }
    };

    // 🔌 Connect server to transport
    console.log("🔌 [MCP] Connecting server to transport...");
    await server.connect(transport);
  } else {
    // ⚠️ Invalid request
    console.warn("⚠️ [MCP] Invalid request: No valid session ID provided");
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

  // 📦 Handle the request
  console.log("📦 [MCP] Handling MCP request...");
  await transport.handleRequest(req, res, req.body);
  console.log("✅ [MCP] MCP request handled.");
});

const handleSessionRequest = async (
  req: express.Request,
  res: express.Response
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  console.log(`🔎 [MCP] ${req.method} /mcp with sessionId:`, sessionId);
  if (!sessionId || !sessions[sessionId]) {
    console.warn("⚠️ [MCP] Invalid or missing session ID");
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = sessions[sessionId].transport;
  // 🔄 Handling session request
  console.log(`🔄 [MCP] Handling ${req.method} for sessionId: ${sessionId}`);
  await transport.handleRequest(req, res);
  console.log(`✅ [MCP] ${req.method} /mcp handled for sessionId:`, sessionId);
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

// Listen on the specified port
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port http://localhost:${PORT}/mcp`);
});
