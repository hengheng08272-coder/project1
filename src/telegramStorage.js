/**
 * "Telegram as storage": an alternative to R2 for a group whose
 * `storage_backend` is set to "telegram" -- the source message is forwarded
 * into one private storage chat the userbot already has access to, exactly
 * like the existing "Mirror to new group" forward path, so the file is
 * copied server-side by Telegram and never touches this process's disk or
 * bandwidth. Free, but retrieval later has to go back through Telegram
 * (see downloadStoredMessage) rather than a static CDN URL.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { telegramSettings } from "./db.js";
import { withFloodRetry } from "./floodRetry.js";
import { mediaInfo } from "./scanner.js";
import { getClient, normalizeChatId } from "./telegram.js";

/** Forwards one source message into the configured storage chat. */
export async function storeMessage(sourceChatId, messageId) {
  const conf = await telegramSettings();
  if (!conf.storageChatId) {
    throw new Error("No Telegram storage channel is configured (Settings › Telegram).");
  }

  const client = await getClient();
  const sourceEntity = await client.getEntity(normalizeChatId(sourceChatId));
  const storageChatId = normalizeChatId(conf.storageChatId);
  const storageEntity = await client.getEntity(storageChatId);

  const sent = await withFloodRetry(
    () => client.forwardMessages(storageEntity, { messages: [Number(messageId)], fromPeer: sourceEntity }),
    { label: `telegram-storage forward ${sourceChatId}/${messageId}` }
  );
  const first = Array.isArray(sent) ? sent[0] : sent;
  if (!first?.id) {
    throw new Error(
      "Telegram would not copy this message into the storage channel -- likely content protection on the source group."
    );
  }

  return { chatId: String(storageChatId), messageId: first.id };
}

/**
 * Fetches a previously-stored message's media into a temp file so it can be
 * streamed to a browser -- the same download-then-relay shape as linkBot.js,
 * including the same "always clean up after" contract on the caller.
 */
export async function downloadStoredMessage(chatId, messageId) {
  const client = await getClient();
  const entity = await client.getEntity(normalizeChatId(chatId));
  const found = await withFloodRetry(() => client.getMessages(entity, { ids: Number(messageId) }), {
    label: `telegram-storage fetch ${chatId}/${messageId}`,
  });
  const msg = Array.isArray(found) ? found[0] : found;
  if (!msg?.media) throw new Error("This stored message no longer has any media.");

  const info = mediaInfo(msg);
  await fsp.mkdir(config.downloadDir, { recursive: true });
  const localPath = path.join(config.downloadDir, `tgstore-${chatId}-${messageId}-${info?.fileName || "file"}`);
  await withFloodRetry(() => client.downloadMedia(msg, { outputFile: localPath }), {
    label: `telegram-storage download ${chatId}/${messageId}`,
  });

  const stream = fs.createReadStream(localPath);
  stream.on("close", () => {
    fsp.unlink(localPath).catch(() => {});
  });
  const stat = await fsp.stat(localPath);
  return {
    stream,
    contentType: info?.mimeType || "application/octet-stream",
    contentLength: stat.size,
    fileName: info?.fileName || `${messageId}`,
  };
}
