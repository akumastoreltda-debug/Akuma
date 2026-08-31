import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const AMAZON_NOTIFICATION_CHANNELS = [
  "slack",
  "discord",
  "microsoft_teams",
  "webhook",
] as const;

export type AmazonNotificationChannel =
  (typeof AMAZON_NOTIFICATION_CHANNELS)[number];

export class AmazonNotificationConfigurationError extends Error {}

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET é necessário para proteger o destino de notificações");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptNotificationDestination(destination: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(destination, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptNotificationDestination(value: string): string {
  const [ivEncoded, authTagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error("Destino de notificação protegido inválido");
  }
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function validateNotificationDestination(
  channel: AmazonNotificationChannel,
  destination: string,
): string {
  const value = destination.trim();
  if (!value || value.length > 2048) {
    throw new AmazonNotificationConfigurationError("Informe um destino de notificação válido");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AmazonNotificationConfigurationError("O destino de notificação precisa ser uma URL HTTPS");
  }
  if (url.protocol !== "https:") {
    throw new AmazonNotificationConfigurationError("O destino de notificação precisa ser uma URL HTTPS");
  }

  if (channel === "slack" && url.hostname !== "hooks.slack.com") {
    throw new AmazonNotificationConfigurationError("Informe uma URL de webhook do Slack");
  }
  if (channel === "discord" && url.hostname !== "discord.com" && url.hostname !== "discordapp.com") {
    throw new AmazonNotificationConfigurationError("Informe uma URL de webhook do Discord");
  }
  if (
    channel === "microsoft_teams" &&
    url.hostname !== "webhook.office.com" &&
    url.hostname !== "logic.azure.com" &&
    !url.hostname.endsWith(".logic.azure.com")
  ) {
    throw new AmazonNotificationConfigurationError("Informe uma URL de webhook do Microsoft Teams");
  }
  return value;
}

export type AmazonDegradationNotification = {
  channel: AmazonNotificationChannel;
  destination: string;
  module: string;
  category: string;
  degradedSamples: number;
  sampleWindow: number;
  observedLatencyMs: number;
};

function notificationText(notification: Omit<AmazonDegradationNotification, "channel" | "destination">): string {
  return [
    `Módulo: ${notification.module}`,
    `Categoria: ${notification.category}`,
    `Amostras: ${notification.degradedSamples} de ${notification.sampleWindow}`,
    `Latência observada: ${notification.observedLatencyMs} ms`,
  ].join("\n");
}

export async function sendAmazonDegradationNotification(
  notification: AmazonDegradationNotification,
): Promise<void> {
  const text = notificationText(notification);
  const body =
    notification.channel === "discord"
      ? { content: text }
      : { text };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(notification.destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Canal externo respondeu HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}