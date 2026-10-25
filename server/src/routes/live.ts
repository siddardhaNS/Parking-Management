import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { all, get } from '../db.js';
import { engine } from '../engine.js';
import { mqttBridge } from '../integrations.js';

/** Pushes every camera update and lot summary to connected dashboards over one WebSocket. */
export default async function liveRoutes(app: FastifyInstance) {
  const clients = new Set<WebSocket>();

  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  engine.on('camera', (live) => broadcast({ type: 'camera', data: live }));
  engine.on('lot', (summary) => {
    broadcast({ type: 'lot', data: summary });
    const lot = get<{ slug: string }>('SELECT slug FROM lots WHERE id = ?', summary.lotId);
    if (lot) mqttBridge.publish(`lots/${lot.slug}/vacancy`, summary, true);
  });

  app.get('/api/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    for (const w of engine.workers.values()) socket.send(JSON.stringify({ type: 'camera', data: w.live() }));
    for (const { id } of all<{ id: number }>('SELECT id FROM lots')) {
      socket.send(JSON.stringify({ type: 'lot', data: engine.lotSummary(id) }));
    }
  });
}
