import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashApiKey } from '../auth.js';
import { all, getSetting, run, setSetting } from '../db.js';
import { modelInfo } from '../detector.js';
import { MQTT_DEFAULTS, mqttBridge, SMTP_DEFAULTS } from '../integrations.js';

const MASK = '••••••••';

const SettingsBody = z.object({
  smtp: z.object({
    host: z.string().trim(),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim(),
    pass: z.string(),
    from: z.string().trim(),
  }),
  mqtt: z.object({
    url: z.string().trim(),
    username: z.string().trim(),
    password: z.string(),
    baseTopic: z.string().trim().min(1),
  }),
});

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const smtp = getSetting('smtp', SMTP_DEFAULTS);
    const mqtt = getSetting('mqtt', MQTT_DEFAULTS);
    return {
      smtp: { ...smtp, pass: smtp.pass ? MASK : '' },
      mqtt: { ...mqtt, password: mqtt.password ? MASK : '' },
      mqttConnected: mqttBridge.connected,
      model: modelInfo(),
    };
  });

  app.put('/api/settings', async (req) => {
    const body = SettingsBody.parse(req.body);
    const oldSmtp = getSetting('smtp', SMTP_DEFAULTS);
    const oldMqtt = getSetting('mqtt', MQTT_DEFAULTS);
    // The UI echoes back the mask for unchanged secrets.
    setSetting('smtp', { ...body.smtp, pass: body.smtp.pass === MASK ? oldSmtp.pass : body.smtp.pass });
    setSetting('mqtt', { ...body.mqtt, password: body.mqtt.password === MASK ? oldMqtt.password : body.mqtt.password });
    mqttBridge.reconfigure();
    return { ok: true };
  });

  app.get('/api/api-keys', async () =>
    all('SELECT id, name, prefix, usage_count, created_at, last_used_at FROM api_keys ORDER BY created_at DESC'),
  );

  app.post('/api/api-keys', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const key = `lw_${crypto.randomBytes(24).toString('base64url')}`;
    run(
      'INSERT INTO api_keys (name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?)',
      name,
      key.slice(0, 10),
      hashApiKey(key),
      Date.now(),
    );
    return { key }; // shown once; only the hash is stored
  });

  app.delete('/api/api-keys/:id', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    run('DELETE FROM api_keys WHERE id = ?', id);
    return { ok: true };
  });
}
