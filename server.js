// MCP-сервер (Streamable HTTP) — обёртка над Coolify API v1.
// Поднимается как отдельный сервис на VPS (вне workers.dev),
// чтобы локальные клиенты (Cursor и т.п.) не упирались в bot-фильтр Cloudflare.

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = Number(process.env.PORT) || 3000;
const MCP_SECRET = process.env.MCP_SECRET;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const COOLIFY_URL = (process.env.COOLIFY_URL || "").replace(/\/+$/, "");

if (!MCP_SECRET || !COOLIFY_TOKEN || !COOLIFY_URL) {
  console.error(
    "Не заданы обязательные переменные окружения: MCP_SECRET, COOLIFY_TOKEN, COOLIFY_URL"
  );
  process.exit(1);
}

// Единый хелпер запросов к Coolify API
async function coolify(method, path, { query, body } = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${COOLIFY_URL}/api/v1${cleanPath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${COOLIFY_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Сетевая ошибка: ${e.message}` };
  }
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return res.ok
    ? { ok: true, status: res.status, data }
    : { ok: false, status: res.status, error: data };
}

// Описание инструментов: имя, описание, JSON-схема входа, обработчик.
const TOOLS = [
  {
    name: "list_applications",
    description:
      "Список всех приложений Coolify: uuid, имя, домен, статус, репозиторий/ветка.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => coolify("GET", "/applications"),
  },
  {
    name: "get_application",
    description: "Полная информация о приложении по uuid.",
    inputSchema: {
      type: "object",
      properties: { uuid: { type: "string", description: "UUID приложения" } },
      required: ["uuid"],
    },
    handler: ({ uuid }) => coolify("GET", `/applications/${uuid}`),
  },
  {
    name: "get_application_logs",
    description: "Логи рантайма приложения (последние N строк).",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения" },
        lines: { type: "integer", description: "Сколько строк с конца (по умолчанию 100)" },
      },
      required: ["uuid"],
    },
    handler: ({ uuid, lines }) =>
      coolify("GET", `/applications/${uuid}/logs`, { query: { lines: lines ?? 100 } }),
  },
  {
    name: "list_application_deployments",
    description: "История деплоев конкретного приложения.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения" },
        skip: { type: "integer", description: "Сколько пропустить" },
        take: { type: "integer", description: "Сколько записей (по умолчанию 10)" },
      },
      required: ["uuid"],
    },
    handler: ({ uuid, skip, take }) =>
      coolify("GET", `/deployments/applications/${uuid}`, {
        query: { skip: skip ?? 0, take: take ?? 10 },
      }),
  },
  {
    name: "list_services",
    description: "Список сервисов Coolify.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => coolify("GET", "/services"),
  },
  {
    name: "deploy",
    description: "Запустить деплой по uuid ресурса или тегу.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения/ресурса" },
        tag: { type: "string", description: "Тег деплоя" },
        force: { type: "boolean", description: "Форсировать пересборку" },
      },
    },
    handler: ({ uuid, tag, force }) => {
      if (!uuid && !tag) return { ok: false, status: 0, error: "Нужен uuid или tag" };
      return coolify("GET", "/deploy", { query: { uuid, tag, force } });
    },
  },
  {
    name: "list_deployments",
    description: "Текущие выполняющиеся деплои по всему инстансу.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => coolify("GET", "/deployments"),
  },
  {
    name: "get_deployment",
    description: "Деталь деплоя по deployment_uuid (статус, логи сборки).",
    inputSchema: {
      type: "object",
      properties: { deployment_uuid: { type: "string", description: "UUID деплоя" } },
      required: ["deployment_uuid"],
    },
    handler: ({ deployment_uuid }) => coolify("GET", `/deployments/${deployment_uuid}`),
  },
  {
    name: "cancel_deployment",
    description: "Отменить выполняющийся деплой.",
    inputSchema: {
      type: "object",
      properties: { deployment_uuid: { type: "string", description: "UUID деплоя" } },
      required: ["deployment_uuid"],
    },
    handler: ({ deployment_uuid }) =>
      coolify("GET", `/deployments/${deployment_uuid}/cancel`),
  },
  {
    name: "application_action",
    description: "Запустить, остановить или перезапустить приложение.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения" },
        action: { type: "string", enum: ["start", "stop", "restart"], description: "Действие" },
      },
      required: ["uuid", "action"],
    },
    handler: ({ uuid, action }) => coolify("GET", `/applications/${uuid}/${action}`),
  },
  {
    name: "service_action",
    description: "Запустить, остановить или перезапустить сервис.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID сервиса" },
        action: { type: "string", enum: ["start", "stop", "restart"], description: "Действие" },
      },
      required: ["uuid", "action"],
    },
    handler: ({ uuid, action }) => coolify("GET", `/services/${uuid}/${action}`),
  },
  {
    name: "list_envs",
    description: "Переменные окружения приложения.",
    inputSchema: {
      type: "object",
      properties: { uuid: { type: "string", description: "UUID приложения" } },
      required: ["uuid"],
    },
    handler: ({ uuid }) => coolify("GET", `/applications/${uuid}/envs`),
  },
  {
    name: "set_env",
    description:
      "Создать или обновить переменную окружения приложения (PATCH, при отсутствии — POST).",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения" },
        key: { type: "string", description: "Имя переменной" },
        value: { type: "string", description: "Значение" },
        is_build_time: { type: "boolean", description: "Доступна на этапе сборки" },
        is_preview: { type: "boolean", description: "Для preview-окружения" },
      },
      required: ["uuid", "key", "value"],
    },
    handler: async ({ uuid, key, value, is_build_time, is_preview }) => {
      const body = {
        key,
        value,
        is_build_time: !!is_build_time,
        is_preview: !!is_preview,
      };
      let r = await coolify("PATCH", `/applications/${uuid}/envs`, { body });
      if (!r.ok && (r.status === 404 || r.status === 400 || r.status === 422)) {
        r = await coolify("POST", `/applications/${uuid}/envs`, { body });
      }
      return r;
    },
  },
  {
    name: "delete_env",
    description: "Удалить переменную окружения приложения по env_uuid.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: { type: "string", description: "UUID приложения" },
        env_uuid: { type: "string", description: "UUID переменной" },
      },
      required: ["uuid", "env_uuid"],
    },
    handler: ({ uuid, env_uuid }) =>
      coolify("DELETE", `/applications/${uuid}/envs/${env_uuid}`),
  },
  {
    name: "coolify_request",
    description:
      "Универсальный запрос к Coolify API v1 для всего, что не покрыто остальными инструментами. path указывается без префикса /api/v1 (например /servers, /projects).",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"], description: "HTTP-метод" },
        path: { type: "string", description: "Путь после /api/v1" },
        query: { type: "object", description: "Query-параметры", additionalProperties: true },
        body: { description: "Тело запроса (JSON)" },
      },
      required: ["method", "path"],
    },
    handler: ({ method, path, query, body }) => coolify(method, path, { query, body }),
  },
];

function buildServer() {
  const server = new Server(
    { name: "coolify-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Неизвестный инструмент: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const r = await tool.handler(req.params.arguments || {});
      const payload = r.ok ? r.data : { status: r.status, error: r.error };
      const text =
        typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      return { content: [{ type: "text", text }], isError: !r.ok };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Ошибка инструмента: ${e.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

// Лёгкий CORS — на случай браузерных клиентов/MCP-инспектора
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "coolify-mcp" }));
app.get("/", (_req, res) => res.type("text").send("coolify-mcp is running"));

function secretOk(req, res) {
  if (req.params.secret !== MCP_SECRET) {
    res.status(404).json({ error: "not found" });
    return false;
  }
  return true;
}

// Streamable HTTP, stateless: на каждый запрос — свежий сервер и транспорт.
app.post("/:secret/mcp", async (req, res) => {
  if (!secretOk(req, res)) return;
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("Ошибка обработки MCP-запроса:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Внутренняя ошибка сервера" },
        id: null,
      });
    }
  }
});

// В stateless-режиме server-initiated SSE и завершение сессии не нужны.
for (const method of ["get", "delete"]) {
  app[method]("/:secret/mcp", (req, res) => {
    if (!secretOk(req, res)) return;
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Метод не поддерживается (stateless)" },
      id: null,
    });
  });
}

app.listen(PORT, () => console.log(`coolify-mcp слушает порт ${PORT}`));
