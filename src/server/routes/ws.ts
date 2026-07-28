import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

export async function wsRoutes(app: FastifyInstance) {
  await app.register(websocket);

  const clients = new Set<import('ws').WebSocket>();

  const snapshot = () =>
    JSON.stringify({ type: 'snapshot', taps: app.ctx.state.getTapStates() });

  app.ctx.bus.on('state_changed', (e) => {
    if (e.scope !== 'taps') return;
    const msg = snapshot();
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(snapshot());
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
