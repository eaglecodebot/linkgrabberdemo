import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('Windows token protection timed out.')); }, 15000);
    p.stdout.on('data', b => output += b);
    p.stderr.resume();
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Windows could not protect/read this token. Re-enter it using this Windows login.')); });
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}

export class Secrets {
  constructor(directory) { this.keyPath = join(directory, 'token-key'); }
  key() {
    if (!existsSync(this.keyPath)) writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    return readFileSync(this.keyPath);
  }
  async encrypt(token) {
    if (process.platform === 'win32') {
      return 'dpapi:' + await powershell('$ErrorActionPreference="Stop"; $t=[Console]::In.ReadToEnd(); ConvertFrom-SecureString (ConvertTo-SecureString $t -AsPlainText -Force)', token);
    }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return 'aes:' + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  async decrypt(value) {
    if (value.startsWith('dpapi:')) {
      return powershell('$ErrorActionPreference="Stop"; $s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }', value.slice(6));
    }
    const b = Buffer.from(value.slice(4), 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key(), b.subarray(0, 12));
    cipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8');
  }
}
