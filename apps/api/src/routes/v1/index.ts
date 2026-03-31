/**
 * v1/index.ts
 * RESTful API v1 入口
 *
 * 使用 @hono/zod-openapi 创建 OpenAPI 兼容的 API
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { filesRoute } from './files';
import { foldersRoute } from './folders';
import { sharesRoute } from './shares';
import { searchRoute } from './search';
import { meRoute } from './me';

const app = new OpenAPIHono();

app.route('/files', filesRoute);
app.route('/folders', foldersRoute);
app.route('/shares', sharesRoute);
app.route('/search', searchRoute);
app.route('/me', meRoute);

app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'OSSShelf API v1',
    version: '1.0.0',
    description: 'OSSShelf 文件管理系统 RESTful API',
  },
  servers: [{ url: '/api/v1', description: '当前服务器' }],
});

app.get('/docs', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OSSShelf API Documentation</title>
      <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
      <style>
        body { margin: 0; background: #fafafa; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info .title { font-size: 28px; }
        .swagger-ui .info .description { font-size: 14px; }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        SwaggerUIBundle({
          url: '/api/v1/openapi.json',
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIBundle.SwaggerUIStandalonePreset
          ],
          layout: 'BaseLayout',
          deepLinking: true
        })
      </script>
    </body>
    </html>
  `);
});

export default app;
