import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRole } from '../src/shared/types.ts';

/**
 * Fallback secret store persisted next to the SQLite database so that a restart without
 * environment variables neither invalidates issued session tokens nor renders encrypted
 * KYC documents undecryptable. Explicit env vars always take precedence.
 */
const SECRETS_FILE = path.join(
  path.dirname(
    process.env.SIMCOVA_DB_PATH
      ? path.resolve(process.env.SIMCOVA_DB_PATH)
      : path.join(process.cwd(), 'data', 'simcova.db')
  ),
  'simcova-secrets.json'
);

interface PersistedSecrets {
  tokenSecret: string;
  kycKey: string;
  webhookSecret: string;
}

function loadOrCreateSecrets(): PersistedSecrets {
  try {
    const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedSecrets>;
    if (parsed.tokenSecret && parsed.kycKey && parsed.webhookSecret) {
      return parsed as PersistedSecrets;
    }
  } catch {
    // First run or unreadable file — regenerate below.
  }
  const generated: PersistedSecrets = {
    tokenSecret: crypto.randomBytes(32).toString('hex'),
    kycKey: crypto.randomBytes(32).toString('hex'),
    webhookSecret: crypto.randomBytes(24).toString('hex'),
  };
  try {
    fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 });
    console.warn(
      `[SIMCOVA] Secrets générés et persistés dans ${SECRETS_FILE}. ` +
        'Pour un déploiement de production, définissez plutôt SIMCOVA_TOKEN_SECRET, ' +
        'SIMCOVA_KYC_ENCRYPTION_KEY et JUMIA_AFRICA_WEBHOOK_SECRET dans l’environnement.'
    );
  } catch (err) {
    console.warn('[SIMCOVA] Impossible de persister les secrets de secours :', err);
  }
  return generated;
}

const persistedSecrets = loadOrCreateSecrets();

function getTokenSecret(): Buffer {
  const raw = process.env.SIMCOVA_TOKEN_SECRET?.trim();
  if (raw && raw.length >= 16) {
    return crypto.createHash('sha256').update(raw).digest();
  }
  return crypto.createHash('sha256').update(persistedSecrets.tokenSecret).digest();
}

function getKycKey(): Buffer {
  const raw = process.env.SIMCOVA_KYC_ENCRYPTION_KEY?.trim();
  if (raw && raw.length >= 16) {
    return crypto.createHash('sha256').update(raw).digest();
  }
  return crypto.createHash('sha256').update(persistedSecrets.kycKey).digest();
}

/** Webhook HMAC secret shared with the Jumia Africa payment adapter. */
export function getWebhookSecret(): string {
  return process.env.JUMIA_AFRICA_WEBHOOK_SECRET?.trim() || persistedSecrets.webhookSecret;
}

/**
 * Length-safe constant-time string comparison (hash both sides to fixed-size digests).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = crypto.scryptSync(password, salt, 64);
    if (keyBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(keyBuf, derived);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

interface SignedPayload {
  typ: 'session' | 'order_track' | 'msg_thread' | 'pwd_reset';
  sub: string;
  role?: UserRole;
  ver?: number;
  exp: number;
}

function signPayload(payload: SignedPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getTokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedPayload(token: string, expectedTyp: SignedPayload['typ']): SignedPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getTokenSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPayload;
    if (parsed.typ !== expectedTyp) return null;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signSessionToken(userId: string, role: UserRole): string {
  return signPayload({
    typ: 'session',
    sub: userId,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

export function verifySessionToken(token: string): { userId: string; role: UserRole } | null {
  const parsed = verifySignedPayload(token, 'session');
  if (!parsed || !parsed.role) return null;
  return { userId: parsed.sub, role: parsed.role };
}

/**
 * EXF-405 / EXF-408: Signed non-guessable tracking token with bounded lifetime (180 days) and version for revocation.
 */
export function signOrderTrackingToken(orderId: string, tokenVersion: number): string {
  return signPayload({
    typ: 'order_track',
    sub: orderId,
    ver: tokenVersion,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 180,
  });
}

export function verifyOrderTrackingToken(token: string): { orderId: string; version: number } | null {
  const parsed = verifySignedPayload(token, 'order_track');
  if (!parsed || typeof parsed.ver !== 'number') return null;
  return { orderId: parsed.sub, version: parsed.ver };
}

export function signMessageThreadToken(threadId: string, tokenVersion: number): string {
  return signPayload({
    typ: 'msg_thread',
    sub: threadId,
    ver: tokenVersion,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 90,
  });
}

export function verifyMessageThreadToken(token: string): { threadId: string; version: number } | null {
  const parsed = verifySignedPayload(token, 'msg_thread');
  if (!parsed || typeof parsed.ver !== 'number') return null;
  return { threadId: parsed.sub, version: parsed.ver };
}

/**
 * EXF-104 / EXNF-05: AES-256-GCM encryption at rest for sensitive vendor KYC documents.
 */
export function encryptKycPayload(plainBuffer: Buffer): { encryptedBase64: string; ivHex: string; authTagHex: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKycKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedBase64: encrypted.toString('base64'),
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
  };
}

export function decryptKycPayload(encryptedBase64: string, ivHex: string, authTagHex: string): Buffer | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKycKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()]);
  } catch {
    return null;
  }
}
