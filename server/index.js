import { createApp } from './app.js';

const port = Number(process.env.PORT) || 8787;
const server = createApp();
server.listen(port, '0.0.0.0', () => console.log(`Value Dialogue running on http://localhost:${port}`));
