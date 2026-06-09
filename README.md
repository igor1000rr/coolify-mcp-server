# coolify-mcp-server

MCP-сервер по протоколу Streamable HTTP — обёртка над Coolify API v1.
Поднят как отдельный сервис на VPS (вне workers.dev), чтобы локальные клиенты
(Cursor и т.п.) не упирались в bot-фильтр Cloudflare на `*.workers.dev`.

## Переменные окружения

- `COOLIFY_TOKEN` — API-токен Coolify (секрет, задаётся в Coolify, не в коде).
- `COOLIFY_URL` — база Coolify, например `http://45.135.234.145:8000`.
- `MCP_SECRET` — секрет в пути эндпоинта.
- `PORT` — порт сервера (по умолчанию 3000).

## Эндпоинт

`POST https://<host>/<MCP_SECRET>/mcp`

## Инструменты

`list_applications`, `get_application`, `get_application_logs`,
`list_application_deployments`, `list_services`, `deploy`, `list_deployments`,
`get_deployment`, `cancel_deployment`, `application_action`, `service_action`,
`list_envs`, `set_env`, `delete_env`, `coolify_request`.

## Локальный запуск

```
npm install
COOLIFY_TOKEN=... COOLIFY_URL=... MCP_SECRET=... npm start
```
