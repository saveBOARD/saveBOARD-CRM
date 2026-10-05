const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Record ids in URLs are uuids. Anything else is a "not found", never a database error. */
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
