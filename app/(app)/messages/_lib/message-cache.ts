import type { Attachment, Message } from "@/lib/types";

/**
 * Client-side message/attachment cache, mirroring Java's MessageBrowser messageCache /
 * attachmentCache: a 200-entry LRU keyed by messageId only (MessageBrowser.java:146, 182-194,
 * 532-546). Cleared on a new search (runSearch → clearCache, MessageBrowser.java:681) and when
 * the messages panel is left (ancestorRemoved → clearCache, MessageBrowser.java:292) — never on
 * plain pagination within the same search (loadPageNumber does not clear it).
 *
 * A Map preserves insertion order; re-inserting a key on access moves it to the end so eviction
 * (from the front) always drops the least-recently-used entry, the same behavior as Java's
 * LinkedHashMap + removeEldestEntry.
 */
const MAX_CACHE_SIZE = 200;

const messageCache = new Map<number, Message>();
const attachmentCache = new Map<number, Attachment[]>();

function touch<T>(cache: Map<number, T>, messageId: number, value: T): void {
  cache.delete(messageId);
  cache.set(messageId, value);
  if (cache.size > MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function getCachedMessage(messageId: number): Message | undefined {
  const hit = messageCache.get(messageId);
  if (hit !== undefined) touch(messageCache, messageId, hit); // bump recency on read
  return hit;
}

export function putCachedMessage(messageId: number, message: Message): void {
  touch(messageCache, messageId, message);
}

export function getCachedAttachments(messageId: number): Attachment[] | undefined {
  const hit = attachmentCache.get(messageId);
  if (hit !== undefined) touch(attachmentCache, messageId, hit);
  return hit;
}

export function putCachedAttachments(messageId: number, attachments: Attachment[]): void {
  touch(attachmentCache, messageId, attachments);
}

export function clearMessageCache(): void {
  messageCache.clear();
  attachmentCache.clear();
}
