import { encodeBase64, encodeUtf8, type PluginCrypto } from '@loge/api';

/**
 * The file around the backup database: a 76-byte header, then AES-256-GCM
 * over the serialized database. The first 64 bytes are the additional data,
 * and the last twelve of the header are the nonce, which GCM authenticates by
 * itself — so nothing in the header can change unnoticed.
 *
 * | at | bytes | field |
 * | -- | ----- | ----- |
 * | 0  | 4     | magic `LGBK` |
 * | 4  | 2     | format version |
 * | 6  | 2     | schema version of the database inside |
 * | 8  | 8     | key id: which key opens it |
 * | 16 | 16    | lineage: the account it holds, hashed |
 * | 32 | 4     | generation: +1 each save |
 * | 36 | 16    | writer: the install that saved it, hashed |
 * | 52 | 8     | created at, in milliseconds |
 * | 60 | 4     | reserved, zero |
 * | 64 | 12    | nonce |
 */

export const HEADER_BYTES = 76;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const FORMAT_VERSION = 1;

const FIELD_BYTES = 64;
const TAG_BYTES = 16;
const MAGIC = [0x4c, 0x47, 0x42, 0x4b];

export interface BackupHeader {
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly keyId: Uint8Array;
  readonly lineage: Uint8Array;
  readonly generation: number;
  readonly writer: Uint8Array;
  readonly createdAt: number;
}

/** Why a file does not open, in the words the app shows. */
export type OpenFailure = 'too-large' | 'not-a-backup' | 'newer' | 'wrong-key' | 'damaged';

export interface BackupKeys {
  readonly fileKey: Uint8Array;
  readonly keyId: Uint8Array;
}

type Crypto = Pick<PluginCrypto, 'sha256' | 'expandKey' | 'seal' | 'open'>;

/** The file's encryption key and key id, each its own expansion of the backup key. */
export async function deriveBackupKeys(key: Uint8Array, crypto: Crypto): Promise<BackupKeys> {
  return {
    fileKey: await crypto.expandKey(key, 'loge/backup/v1|file', 32),
    keyId: await crypto.expandKey(key, 'loge/backup/v1|key-id', 8),
  };
}

/** Sixteen bytes that name something without saying it: an account, an install. */
export async function tagOf(crypto: Crypto, purpose: 'lineage' | 'writer', value: string): Promise<Uint8Array> {
  return (await crypto.sha256(encodeUtf8(`loge/backup/v1|${purpose}\n${value}`))).subarray(0, 16);
}

const additionalData = (fields: Uint8Array) => `loge/backup/v1|${encodeBase64(fields)}`;

function fieldsOf(header: BackupHeader): Uint8Array {
  const fields = new Uint8Array(FIELD_BYTES);
  const view = new DataView(fields.buffer);
  fields.set(MAGIC, 0);
  view.setUint16(4, header.formatVersion);
  view.setUint16(6, header.schemaVersion);
  fields.set(header.keyId.subarray(0, 8), 8);
  fields.set(header.lineage.subarray(0, 16), 16);
  view.setUint32(32, header.generation);
  fields.set(header.writer.subarray(0, 16), 36);
  // Two halves rather than a BigInt, which not every engine the app runs on has for DataView.
  const createdAt = Math.max(0, Math.floor(header.createdAt));
  view.setUint32(52, Math.floor(createdAt / 2 ** 32));
  view.setUint32(56, createdAt % 2 ** 32);
  return fields;
}

/** The header of something that may be a backup, read without any key: enough to say what it is. */
export function readHeader(bytes: Uint8Array): BackupHeader | Exclude<OpenFailure, 'wrong-key' | 'damaged'> {
  if (bytes.length > MAX_BACKUP_BYTES) return 'too-large';
  if (bytes.length < HEADER_BYTES + TAG_BYTES || MAGIC.some((byte, at) => bytes[at] !== byte)) return 'not-a-backup';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatVersion = view.getUint16(4);
  if (formatVersion > FORMAT_VERSION) return 'newer';
  if (formatVersion < 1) return 'not-a-backup';
  return {
    formatVersion,
    schemaVersion: view.getUint16(6),
    keyId: bytes.slice(8, 16),
    lineage: bytes.slice(16, 32),
    generation: view.getUint32(32),
    writer: bytes.slice(36, 52),
    createdAt: view.getUint32(52) * 2 ** 32 + view.getUint32(56),
  };
}

/** Header ‖ nonce ‖ ciphertext ‖ tag: the crypto port writes the nonce right where the header ends. */
export async function sealBackup(crypto: Crypto, keys: BackupKeys, header: Omit<BackupHeader, 'keyId' | 'formatVersion'>, database: Uint8Array): Promise<Uint8Array> {
  const fields = fieldsOf({ ...header, formatVersion: FORMAT_VERSION, keyId: keys.keyId });
  const sealed = await crypto.seal(keys.fileKey, database, additionalData(fields));
  const file = new Uint8Array(FIELD_BYTES + sealed.length);
  file.set(fields, 0);
  file.set(sealed, FIELD_BYTES);
  return file;
}

/** Everything checked before anything is believed: the size, the header, the key, and the seal. */
export async function openBackup(crypto: Crypto, keys: BackupKeys, bytes: Uint8Array): Promise<{ readonly header: BackupHeader; readonly database: Uint8Array } | OpenFailure> {
  const header = readHeader(bytes);
  if (typeof header === 'string') return header;
  if (header.keyId.some((byte, at) => keys.keyId[at] !== byte)) return 'wrong-key';
  const database = await crypto.open(keys.fileKey, bytes.subarray(FIELD_BYTES), additionalData(bytes.subarray(0, FIELD_BYTES)));
  return database ? { header, database } : 'damaged';
}
