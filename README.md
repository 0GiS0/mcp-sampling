# Servidor de Sampling MCP

Un servidor Model Context Protocol (MCP) que demuestra la implementación correcta de capacidades de sampling con LLMs.

## ¿Cómo funciona el Sampling en MCP?

El *sampling* en MCP consiste en pedirle a un cliente (por ejemplo, Claude Desktop, VSCode, etc.) que genere una respuesta a partir de un *prompt* proporcionado por una herramienta MCP. El flujo típico es:

1. El cliente llama a una herramienta MCP (por ejemplo, `summarize`).
2. La herramienta devuelve un *prompt* que el cliente debe procesar usando sus capacidades de sampling. ¿esto qué significa? Que en lugar de incluir en el servidor MCP la implementación para llamar a un modelo LLM, le pide al cliente que use uno de sus modelos LLM disponibles para generar la respuesta. Esto permite que el cliente maneje el sampling de manera eficiente y evita dependencias innecesarias en el servidor. Además de que el cliente puede elegir el modelo LLM más adecuado para la tarea y evitamos también tener que tener contraer nuevos servicios o APIs para cada modelo LLM que queramos usar.
3. El cliente genera la respuesta y la envía de vuelta.

### ¡Cuidado con las dependencias circulares!

Un error común al implementar sampling en MCP es crear una dependencia circular. Esto ocurre si, dentro del manejador de una herramienta MCP, intentas llamar a `createMessage` para que el propio cliente genere una respuesta. El ciclo sería:

1. El cliente llama a la herramienta MCP.
2. La herramienta intenta llamar a `createMessage` para que el cliente genere una respuesta.
3. Esto provoca que el cliente espere una respuesta de sí mismo, creando un ciclo infinito y causando *timeouts*.

**Solución recomendada:**  
La herramienta debe devolver el *prompt* directamente al cliente, y dejar que el cliente maneje el sampling. Así se evita la dependencia circular y los problemas de timeout.

Ejemplo correcto en TypeScript:

```typescript
return {
  content: [
    {
      type: "text",
      text: `Por favor, resume el siguiente texto:\n\n${text}`,
    },
  ],
};
```

## Resumen de la arquitectura

- **Separación de responsabilidades:** La herramienta solo genera el *prompt*, el cliente realiza el sampling.
- **Evitar dependencias circulares:** Nunca llames a `createMessage` desde dentro de una herramienta MCP.
- **Gestión de sesiones:** Cada sesión MCP debe tener su propia instancia de servidor.
- **Detección de capacidades:** Verifica si el cliente soporta sampling antes de solicitarlo.
- **Manejo de errores:** Informa claramente si el sampling no está disponible.

## Uso

### Iniciar el servidor

```bash
npm install
npm run build
node build/index.js
```

### Usar la herramienta MCP

Conecta tu cliente MCP a `http://localhost:3001/mcp` y usa la herramienta `summarize`.  
El cliente recibirá un *prompt* y realizará el sampling correctamente, sin ciclos.

### Interfaz web (opcional)

Abre `http://localhost:3001` en tu navegador para probar el sampling directamente.

## Ejemplo de configuración para Claude Desktop

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

## Depuración

Recomendamos usar el [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

El Inspector te dará una URL para acceder a herramientas de depuración en tu navegador.

---

**Recuerda:**  
¡Evita dependencias circulares! Deja que el cliente haga el sampling y tu implementación será robusta y confiable.
