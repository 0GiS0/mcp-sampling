/**
 * 📝 MCP (Model Context Protocol) Sample Server
 * 
 * Este archivo implementa un servidor didáctico usando el Model Context Protocol (MCP) 
 * para gestionar notas de texto. Utiliza la Low-Level API del SDK MCP y Express.js 
 * para exponer endpoints HTTP que permiten listar, leer, crear y resumir notas.
 * 
 * Características principales:
 * - Almacenamiento en memoria de notas (sin base de datos).
 * - Exposición de recursos (notas) vía MCP.
 * - Herramienta para crear nuevas notas.
 * - Prompt para resumir todas las notas.
 * - Manejo de sesiones MCP vía HTTP (POST, GET, DELETE).
 * 
 * Ideal para aprender cómo funciona MCP y cómo integrar recursos, herramientas y prompts.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";

/**
 * Tipo para una nota.
 */
type Note = { title: string; content: string };

/**
 * Almacenamiento en memoria de notas.
 * En una app real, esto sería una base de datos.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" },
};

// 🚀 Inicializa la app Express
const app = express();
app.use(express.json());

// Mapa de transports por sesión
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// 🛠️ Crea el servidor MCP con capacidades de recursos, herramientas y prompts
const server = new Server(
  {
    name: "mcp-sampling",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
      // sampling: {}
    },
  }
);

/**
 * 📋 Handler para listar notas como recursos MCP.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(notes).map(([id, note]) => ({
      uri: `note:///${id}`,
      mimeType: "text/plain",
      name: note.title,
      description: `A text note: ${note.title}`,
    })),
  };
});

/**
 * 📖 Handler para leer el contenido de una nota.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, "");
  const note = notes[id];

  if (!note) {
    throw new Error(`Note ${id} not found`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: note.content,
      },
    ],
  };
});

/**
 * 🛠️ Handler para listar herramientas disponibles (solo "create_note").
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_note",
        description: "Create a new note",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the note",
            },
            content: {
              type: "string",
              description: "Text content of the note",
            },
          },
          required: ["title", "content"],
        },
      },
    ],
  };
});

/**
 * 📝 Handler para la herramienta "create_note".
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "create_note": {
      const title = String(request.params.arguments?.title);
      const content = String(request.params.arguments?.content);
      if (!title || !content) {
        throw new Error("Title and content are required");
      }

      const id = String(Object.keys(notes).length + 1);
      notes[id] = { title, content };

      return {
        content: [
          {
            type: "text",
            text: `Created note ${id}: ${title}`,
          },
        ],
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * 💡 Handler para listar prompts disponibles (solo "summarize_notes").
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_notes",
        description: "Summarize all notes",
      },
    ],
  };
});

/**
 * 🧠 Handler para el prompt "summarize_notes".
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_notes") {
    throw new Error("Unknown prompt");
  }

  const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
    type: "resource" as const,
    resource: {
      uri: `note:///${id}`,
      mimeType: "text/plain",
      text: note.content,
    },
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the following notes:",
        },
      },
      ...embeddedNotes.map((note) => ({
        role: "user" as const,
        content: note,
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Provide a concise summary of all the notes above.",
        },
      },
    ],
  };
});

/**************** Fin de la configuración del servidor MCP ****************/

/**
 * Endpoint principal MCP (POST).
 */
app.post("/mcp", async (req, res) => {
  console.log("📨 Recibida petición MCP POST");
  console.log("📦 Cuerpo de la petición:", req.body);

  try {
    // Busca sessionId en cabecera
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`🔑 Procesando para session ID: ${sessionId}`);

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      console.log(`🔄 Reutilizando transport para sesión ${sessionId}`);
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log("🆕 Sin session ID, inicializando nuevo transport");

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: req?.body?.id,
      });
      return;
    }

    // Maneja la petición con el transport correspondiente
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("❌ Error manejando petición MCP:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: req?.body?.id,
      });
      return;
    }
  }
});

/**
 * Endpoint GET para SSE streams (usado por MCP para eventos).
 */
app.get("/mcp", async (req: Request, res: Response) => {
  console.error("📥 Recibida petición MCP GET");
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  const lastEventId = req.headers["last-event-id"] as string | undefined;
  if (lastEventId) {
    console.error(`🔁 Cliente reconectando con Last-Event-ID: ${lastEventId}`);
  } else {
    console.error(`🌐 Estableciendo nuevo SSE para sesión ${sessionId}`);
  }

  const transport = transports[sessionId];
  await transport!.handleRequest(req, res);
});

/**
 * Endpoint DELETE para terminar sesión MCP.
 */
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  console.error(
    `🗑️ Recibida petición de terminación de sesión para ${sessionId}`
  );

  try {
    const transport = transports[sessionId];
    await transport!.handleRequest(req, res);
  } catch (error) {
    console.error("❌ Error al terminar sesión:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Error handling session termination",
        },
        id: req?.body?.id,
      });
      return;
    }
  }
});

/**
 * 🚦 Inicia el servidor Express.
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`📡 MCP Streamable HTTP Server escuchando en puerto ${PORT}`);
});

/**
 * 🛑 Maneja el apagado del servidor y limpia recursos.
 */
process.on("SIGINT", async () => {
  console.log("🛑 Apagando servidor...");

  // Cierra todos los transports activos
  for (const sessionId in transports) {
    try {
      console.log(`🔒 Cerrando transport para sesión ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`❌ Error cerrando transport para sesión ${sessionId}:`, error);
    }
  }

  console.error("✅ Apagado completo");
  process.exit(0);
});
