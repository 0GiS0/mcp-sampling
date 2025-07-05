# 🎯 Servidor de Sampling MCP

Un servidor Model Context Protocol (MCP) que demuestra la implementación correcta de capacidades de sampling con LLMs.

## 🤔 ¿Cómo funciona el Sampling en MCP?

El *sampling* en MCP es una característica poderosa que permite que las herramientas MCP soliciten al cliente que genere contenido usando sus propios modelos LLM. En lugar de que el servidor MCP tenga que integrar directamente con proveedores de IA, delega esta responsabilidad al cliente.

### 🔄 Flujo completo del Sampling

El proceso de sampling en MCP sigue este flujo:

1. **El cliente llama a una herramienta MCP** (ej. `summarize`) con parámetros específicos.
2. **La herramienta utiliza `extra.sendRequest`** para enviar una solicitud de `sampling/createMessage` al cliente.
3. **El cliente procesa la solicitud de sampling** usando sus modelos LLM disponibles.
4. **El cliente devuelve el contenido generado** a la herramienta MCP.
5. **La herramienta procesa la respuesta** y la devuelve al cliente original.

### ⭐ Ventajas del Sampling

- **Sin dependencias externas**: El servidor MCP no necesita API keys ni integraciones con proveedores de IA.
- **Flexibilidad del cliente**: El cliente puede elegir el modelo LLM más adecuado para cada tarea.
- **Eficiencia**: Evita llamadas redundantes a APIs externas.
- **Seguridad**: Las credenciales y configuraciones del LLM permanecen en el cliente.

### 💡 Ejemplo práctico

```typescript
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
        costPriority: 0.5,      // Balance costo y rendimiento
        intelligencePriority: 0.5, // Balance inteligencia y rendimiento  
        speedPriority: 0.5,     // Priorizar velocidad
      },
    },
  },
  CreateMessageResultSchema
);
```

### 🔧 Implementación correcta del Sampling

A diferencia de implementaciones incorrectas que podrían causar dependencias circulares, la implementación correcta utiliza el método `sampling/createMessage` a través de `extra.sendRequest`. Este es el patrón recomendado por MCP:

#### ✅ Implementación correcta:

```typescript
// Dentro de la herramienta MCP
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
        costPriority: 0.5,
        intelligencePriority: 0.5,
        speedPriority: 0.5,
      },
    },
  },
  CreateMessageResultSchema
);

return {
  content: [
    {
      type: "text", 
      text: result.content.text,
    },
  ],
};
```

#### ❌ Implementación incorrecta (dependencia circular):

```typescript
// ¡NO hacer esto!
return {
  content: [
    {
      type: "text",
      text: `Por favor, resume el siguiente texto:\n\n${text}`,
    },
  ],
};
```

### ❓ ¿Por qué funciona la implementación correcta?

1. **Separación clara de responsabilidades**: La herramienta solicita el sampling, el cliente lo ejecuta.
2. **Flujo unidireccional**: No hay ciclos en la comunicación.
3. **API estándar**: Utiliza el protocolo MCP oficial para sampling.
4. **Gestión de sesiones**: Cada sesión mantiene su contexto independiente.

## 🏗️ Arquitectura HTTP Streamable

Este servidor implementa MCP usando **StreamableHTTPServerTransport**, que ofrece ventajas significativas sobre otros transportes:

### 🚀 Características del transporte HTTP

- **Conexiones persistentes**: Mantiene sesiones a través de múltiples solicitudes HTTP.
- **Server-Sent Events (SSE)**: Permite notificaciones del servidor al cliente.
- **Gestión de sesiones**: Cada cliente MCP tiene su propia sesión aislada.
- **Escalabilidad**: Puede manejar múltiples clientes simultáneamente.

### 🌊 Flujo de sesión HTTP

```
1. POST /mcp (initialize) → Crea nueva sesión
2. GET /mcp (con mcp-session-id) → Recibe notificaciones via SSE  
3. POST /mcp (con mcp-session-id) → Ejecuta herramientas
4. DELETE /mcp (con mcp-session-id) → Termina sesión
```

### 🎪 Gestión de sesiones

```typescript
// Mapa de sesiones activas
const sessions: {
  [sessionId: string]: {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  };
} = {};

// Cada sesión tiene su propio servidor MCP
server = new McpServer(
  {
    name: "mcp-sampling",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      sampling: {}, // Habilita capacidad de sampling
    },
  }
);
```

## 📋 Resumen de la arquitectura

### 🧩 Componentes principales

- **McpServer**: Instancia del servidor MCP que gestiona herramientas y capacidades.
- **StreamableHTTPServerTransport**: Transporte HTTP que maneja conexiones y sesiones.
- **Express.js**: Servidor web que expone los endpoints HTTP.
- **Gestión de sesiones**: Mapeo de session IDs a instancias de servidor.

### 🎯 Principios de diseño

- **Separación de responsabilidades**: 
  - La herramienta construye solicitudes de sampling
  - El cliente ejecuta el sampling con sus modelos LLM
  - El servidor gestiona sesiones y comunicación
- **Capacidades del servidor**: 
  - Declara `sampling: {}` para indicar soporte de sampling
  - Registra herramientas que pueden usar sampling
- **Gestión de sesiones robusta**: 
  - Cada sesión MCP tiene su propia instancia de servidor
  - Limpieza automática de sesiones al cerrar conexiones
  - Identificación única de sesiones con UUIDs
- **Detección de capacidades**: 
  - Verifica capacidades del cliente durante inicialización
  - Adapta funcionalidad según capacidades disponibles
- **Manejo de errores**: 
  - Validación de session IDs
  - Respuestas HTTP apropiadas para errores
  - Logging detallado para debugging

### 📊 Flujo de datos

```
Cliente MCP → HTTP POST → Express.js → StreamableHTTPServerTransport → McpServer → Herramienta
      ↑                                                                                      ↓
      ← HTTP Response ← Express.js ← StreamableHTTPServerTransport ← McpServer ← sampling/createMessage
```

## 🚀 Uso

### 🔧 Iniciar el servidor

```bash
npm install
npm run build
node build/index.js
```

### 🛠️ Usar la herramienta MCP

Conecta tu cliente MCP a `http://localhost:3001/mcp` y usa la herramienta `summarize`.  
El cliente recibirá un *prompt* y realizará el sampling correctamente, sin ciclos.

### 🌐 Interfaz web (opcional)

Abre `http://localhost:3001` en tu navegador para probar el sampling directamente.

## 🖥️ Ejemplo de configuración para Claude Desktop

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

## 🔍 Depuración y Monitoreo

### 📝 Logging detallado

El servidor incluye logging exhaustivo para facilitar el debugging:

```typescript
// Logs de sesión
console.log("🚀 [MCP] New MCP initialization request received");
console.log("🧑‍💻 [MCP] Client capabilities:", req.body.params.capabilities);
console.log("🛠️ [MCP] Registering summarize tool...");

// Logs de herramientas
console.log("🛠️ [TOOL] Context received in summarize tool:", extra);
console.log("📝 [TOOL] summarize called with text:", text);
console.log("🧠 LLM used for the client:", result.model);
console.log("✅ [TOOL] Summarization complete:", completion);

// Logs de transporte
console.log("📩 [MCP] POST /mcp", { headers: req.headers, body: req.body });
console.log("♻️ [MCP] MCP request received for existing session:", sessionId);
console.log("🔗 [MCP] Session initialized:", sessionId);
```

### 🔧 Herramientas de depuración

#### 🕵️ MCP Inspector

Recomendamos usar el [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

El Inspector te dará una URL para acceder a herramientas de depuración en tu navegador.

#### 📊 Verificación de sesiones

```bash
# Verificar sesiones activas
curl -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}}}' \
     http://localhost:3001/mcp

# Verificar capacidades del servidor
curl -H "Content-Type: application/json" \
     -H "mcp-session-id: <session-id>" \
     -d '{"jsonrpc":"2.0","method":"capabilities","id":1}' \
     http://localhost:3001/mcp
```

### 🚨 Solución de problemas comunes

#### ⚠️ Error: "Invalid or missing session ID"

```bash
# Causa: Solicitud sin session ID válido
# Solución: Asegurar que la inicialización se haga primero
```

#### ⏰ Error: Timeout en sampling

```bash
# Causa: Cliente no soporta sampling
# Solución: Verificar capacidades del cliente
```

#### 🔌 Error: "Connection refused"

```bash
# Causa: Servidor no está corriendo
# Solución: Verificar que el servidor esté en puerto 3001
netstat -an | grep 3001
```

## 💡 Ejemplos prácticos

### 🌟 Ejemplo 1: Uso básico con curl

```bash
# 1. Inicializar sesión
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "capabilities": {"sampling": {}},
      "name": "test-client",
      "version": "1.0.0"
    },
    "id": 1
  }'

# 2. Obtener session ID de la respuesta y usar la herramienta
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id-from-response>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "summarize",
      "arguments": {
        "text": "Este es un texto muy largo que necesita ser resumido..."
      }
    },
    "id": 2
  }'
```

### 🤖 Ejemplo 2: Integración con Claude Desktop

1. **Configurar Claude Desktop**:
   ```json
   {
     "mcpServers": {
       "mcp-sampling": {
         "type": "http",
         "url": "http://localhost:3001/mcp"
       }
     }
   }
   ```

2. **Usar en conversación**:
   ```
   Por favor, usa la herramienta summarize para resumir este artículo:
   [texto del artículo]
   ```

### 📈 Ejemplo 3: Monitoreo de sesiones

```typescript
// Verificar sesiones activas
console.log("Sesiones activas:", Object.keys(sessions));

// Obtener información de sesión
const sessionInfo = sessions[sessionId];
console.log("Transporte:", sessionInfo.transport);
console.log("Servidor:", sessionInfo.server);
```

### 🎨 Ejemplo 4: Personalización de herramientas

```typescript
// Crear herramienta personalizada
const createCustomTool = (serverInstance: McpServer) => {
  serverInstance.registerTool(
    "analyze",
    {
      description: "Analyze text for sentiment and keywords",
      inputSchema: {
        text: z.string().describe("Text to analyze"),
        analysis_type: z.enum(["sentiment", "keywords", "both"])
          .describe("Type of analysis to perform"),
      },
    },
    async function ({ text, analysis_type }, extra) {
      const prompt = analysis_type === "sentiment" 
        ? `Analyze the sentiment of this text: ${text}`
        : `Extract keywords from this text: ${text}`;
        
      const result = await extra.sendRequest({
        method: "sampling/createMessage",
        params: {
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          maxTokens: 300,
        },
      }, CreateMessageResultSchema);
      
      return {
        content: [{ type: "text", text: result.content.text }],
      };
    }
  );
};
```

## 🧪 Validación y Testing

### ✅ Verificar funcionamiento del servidor

```bash
# 1. Construir y ejecutar el servidor
npm run build
npm start

# 2. Verificar que el servidor esté corriendo
curl -I http://localhost:3001/mcp
# Debería devolver: 405 Method Not Allowed (esperado para GET)

# 3. Probar inicialización
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{"sampling":{}}},"id":1}'
```

### 🔬 Validar capacidades de sampling

```bash
# Verificar que el servidor declara capacidades de sampling
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize", 
    "params": {
      "capabilities": {"sampling": {}},
      "name": "test-client",
      "version": "1.0.0"
    },
    "id": 1
  }' | jq '.result.capabilities'
```

### 🔎 Testing con MCP Inspector

```bash
# Instalar y ejecutar el inspector
npm install -g @modelcontextprotocol/inspector
mcp-inspector build/index.js
```

### 🔍 Validar herramientas disponibles

```bash
# Listar herramientas disponibles
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  }' | jq '.result.tools'
```

## ⭐ Mejores prácticas

### 👨‍💻 Para desarrolladores de herramientas MCP

1. **Siempre verificar capacidades**:
   ```typescript
   if (!extra.capabilities?.sampling) {
     throw new Error("Client does not support sampling");
   }
   ```

2. **Manejar errores de sampling**:
   ```typescript
   try {
     const result = await extra.sendRequest(samplingRequest, schema);
     return result;
   } catch (error) {
     console.error("Sampling failed:", error);
     throw error;
   }
   ```

3. **Optimizar prompts**:
   ```typescript
   const prompt = `Please summarize concisely (max 3 sentences):\n\n${text}`;
   ```

### 🏗️ Para administradores de servidor

1. **Configurar logging apropiado**:
   ```typescript
   console.log(`[${new Date().toISOString()}] ${message}`);
   ```

2. **Implementar limpieza de sesiones**:
   ```typescript
   setInterval(() => {
     // Limpiar sesiones inactivas
   }, 30000);
   ```

3. **Monitorear recursos**:
   ```bash
   # Verificar uso de memoria
   ps aux | grep node
   ```

   # Verificar uso de memoria
   ps aux | grep node
   ```

## 🎯 Conclusión

Este servidor MCP demuestra la implementación correcta de sampling usando HTTP transport streamable. Las características clave incluyen:

### ✅ Lo que hace bien este servidor

- **Sampling correcto**: Usa `sampling/createMessage` a través de `extra.sendRequest`
- **Gestión de sesiones**: Mantiene sesiones independientes para cada cliente
- **HTTP streamable**: Soporta notificaciones bidireccionales
- **Logging completo**: Facilita debugging y monitoreo
- **Manejo de errores**: Respuestas apropiadas para casos de error

### 🚀 Casos de uso recomendados

- **Herramientas de productividad**: Resúmenes, análisis de texto, traducciones
- **Procesamiento de documentos**: Extracción de información, categorización
- **Análisis de contenido**: Sentiment analysis, detección de temas
- **Prototipado rápido**: Testing de nuevas ideas con LLMs

### 🔄 Extensiones posibles

- Múltiples herramientas de sampling
- Configuración dinámica de model preferences
- Caché de respuestas para optimización
- Métricas y analytics de uso

---

**Recuerda**: El sampling en MCP es una herramienta poderosa cuando se implementa correctamente. Usa `sampling/createMessage` a través de `extra.sendRequest` y evita las dependencias circulares. ¡Tu implementación será robusta y escalable!
