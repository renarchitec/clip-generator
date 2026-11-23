import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** SOCIAL_TOKEN_KEY menerima hex 64 karakter atau base64 yang decode-nya 32 byte. */
export function decodeSocialTokenKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) throw new Error('SOCIAL_TOKEN_KEY belum dikonfigurasi.');

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    ) {
      throw new Error('SOCIAL_TOKEN_KEY harus berupa base64 atau hex 32 byte.');
    }
    key = Buffer.from(value, 'base64');
  }

  if (key.length !== KEY_BYTES) {
    throw new Error('SOCIAL_TOKEN_KEY harus decode menjadi tepat 32 byte.');
  }
  return key;
}

/** Format versioned: v1:<iv base64url>:<tag base64url>:<ciphertext base64url>. */
export function encryptSocialToken(plaintext: string, keyRaw: string): string {
  const key = decodeSocialTokenKey(keyRaw);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSocialToken(encoded: string, keyRaw: string): string {
  const key = decodeSocialTokenKey(keyRaw);

  try {
    const [version, ivRaw, tagRaw, ciphertextRaw, ...extra] = encoded.split(':');
    if (
      version !== 'v1' ||
      !ivRaw ||
      !tagRaw ||
      ciphertextRaw === undefined ||
      extra.length > 0
    ) {
      throw new Error('format');
    }

    const iv = Buffer.from(ivRaw, 'base64url');
    const tag = Buffer.from(tagRaw, 'base64url');
    const ciphertext = Buffer.from(ciphertextRaw, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('format');
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Token sosial tidak valid atau kunci enkripsi berbeda.');
  }
}
