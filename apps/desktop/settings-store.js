const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const defaults = Object.freeze({
  nineRouterUrl: 'https://9router.rencraft.site/v1',
  nineRouterModel: 'tabi-fixer',
  geminiModel: 'gemini-2.5-flash',
  openaiModel: 'gpt-4o-mini',
  videoEncoder: 'h264_videotoolbox',
});
const keyNames = ['nineRouterApiKey', 'geminiApiKey', 'openaiApiKey'];

function maskSecret(secret) {
  if (!secret) return null;
  return secret.length >= 10 ? `${secret.slice(0, 3)}…${secret.slice(-4)}` : '••••';
}

function updateSettings(current, patch) {
  const updated = { ...current };
  for (const name of Object.keys(defaults)) {
    if (typeof patch[name] !== 'string') continue;
    const value = patch[name].trim();
    if (name === 'videoEncoder' && value !== 'h264_videotoolbox' && value !== 'libx264') continue;
    updated[name] = value;
  }
  return updated;
}

function readKeys(values) {
  return Object.fromEntries(keyNames.flatMap((name) => (
    typeof values?.[name] === 'string' && values[name] ? [[name, values[name]]] : []
  )));
}

class SettingsStore {
  constructor({ dataDir, safeStorage }) {
    this.dataDir = dataDir;
    this.safeStorage = safeStorage;
    this.filePath = path.join(dataDir, 'desktop-settings.json');
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) ?? {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not read ${this.filePath}.`, { cause: error });
    }
    this.settings = updateSettings(defaults, saved);
    this.encryptedKeys = readKeys(saved.encryptedKeys);
    this.plainKeys = readKeys(saved.plainKeys);
    this.encryptionFailed = false;
  }

  canEncrypt() {
    try {
      return this.safeStorage?.isEncryptionAvailable?.() === true;
    } catch {
      return false;
    }
  }

  getSecrets() {
    const secrets = { ...this.plainKeys };
    if (this.canEncrypt()) {
      for (const [name, value] of Object.entries(this.encryptedKeys)) {
        try {
          secrets[name] = this.safeStorage.decryptString(Buffer.from(value, 'base64'));
        } catch {
          // Keep the ciphertext on disk in case the Keychain becomes available again.
        }
      }
    }
    return secrets;
  }

  getView() {
    const keys = this.getSecrets();
    return {
      ...this.settings,
      hasNineRouterApiKey: Boolean(keys.nineRouterApiKey),
      nineRouterApiKeyHint: maskSecret(keys.nineRouterApiKey),
      hasGeminiApiKey: Boolean(keys.geminiApiKey),
      geminiApiKeyHint: maskSecret(keys.geminiApiKey),
      hasOpenaiApiKey: Boolean(keys.openaiApiKey),
      openaiApiKeyHint: maskSecret(keys.openaiApiKey),
      encryptionAvailable: this.canEncrypt() && !this.encryptionFailed && Object.keys(this.plainKeys).length === 0,
      clipsDir: this.dataDir,
    };
  }

  getRuntimeConfig() {
    return { ...this.settings, ...this.getSecrets() };
  }

  applyPatch(patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Invalid desktop settings.');
    }
    const settings = updateSettings(this.settings, patch);
    const encryptedKeys = { ...this.encryptedKeys };
    const plainKeys = { ...this.plainKeys };
    const canEncrypt = this.canEncrypt();
    let encryptionFailed = false;

    for (const name of keyNames) {
      const clearName = `clear${name[0].toUpperCase()}${name.slice(1)}`;
      if (patch[clearName] === true) {
        delete encryptedKeys[name];
        delete plainKeys[name];
        continue;
      }
      const replacement = typeof patch[name] === 'string' ? patch[name].trim() : '';
      const secret = replacement || plainKeys[name];
      if (!secret) continue;
      if (canEncrypt) {
        try {
          encryptedKeys[name] = this.safeStorage.encryptString(secret).toString('base64');
          delete plainKeys[name];
          continue;
        } catch {
          encryptionFailed = true;
        }
      }
      delete encryptedKeys[name];
      plainKeys[name] = secret;
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify({ ...settings, encryptedKeys, plainKeys }, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
    Object.assign(this, { settings, encryptedKeys, plainKeys, encryptionFailed });
    return this.getView();
  }
}

module.exports = { SettingsStore, maskSecret };
