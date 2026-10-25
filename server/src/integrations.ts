import mqtt, { type MqttClient } from 'mqtt';
import nodemailer from 'nodemailer';
import { getSetting } from './db.js';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
  baseTopic: string;
}

export const SMTP_DEFAULTS: SmtpSettings = { host: '', port: 587, secure: false, user: '', pass: '', from: '' };
export const MQTT_DEFAULTS: MqttSettings = { url: '', username: '', password: '', baseTopic: 'lotwatch' };

export async function sendEmail(to: string, subject: string, text: string) {
  const s = getSetting('smtp', SMTP_DEFAULTS);
  if (!s.host) throw new Error('SMTP is not configured');
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  });
  await transport.sendMail({ from: s.from || s.user, to, subject, text });
}

export async function postWebhook(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LotWatch/0.1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);
}

class MqttBridge {
  private client: MqttClient | null = null;
  private settings: MqttSettings = MQTT_DEFAULTS;

  get connected() {
    return this.client?.connected ?? false;
  }

  get baseTopic() {
    return this.settings.baseTopic || 'lotwatch';
  }

  reconfigure() {
    this.client?.end(true);
    this.client = null;
    this.settings = getSetting('mqtt', MQTT_DEFAULTS);
    if (!this.settings.url) return;
    this.client = mqtt.connect(this.settings.url, {
      username: this.settings.username || undefined,
      password: this.settings.password || undefined,
      reconnectPeriod: 10_000,
      clientId: `lotwatch-${Math.random().toString(16).slice(2, 10)}`,
    });
    this.client.on('error', (err) => console.warn(`[mqtt] ${err.message}`));
  }

  publish(subtopic: string, payload: unknown, retain = false) {
    if (!this.client?.connected) return;
    this.client.publish(`${this.baseTopic}/${subtopic}`, JSON.stringify(payload), { retain, qos: 0 });
  }
}

export const mqttBridge = new MqttBridge();
