import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
function encryptionKey(secret) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
    const error = new Error('Ask the administrator to set SCRIPT_ENCRYPTION_KEY in Railway to a fixed 64-character random hexadecimal value.');error.status=503;throw error;
  }
  return Buffer.from(secret,'hex');
}
const context=record=>Buffer.from(JSON.stringify([record._id,record.authVersion,record.revision]));
export function sealScript(script,record,secret) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(secret),iv);cipher.setAAD(context(record));
  const data=Buffer.concat([cipher.update(script,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
export function openScript(record,secret) {
  const key=encryptionKey(secret);
  try {
    const bytes=Buffer.from(record.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(context(record));decipher.setAuthTag(bytes.subarray(12,28));
    return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
  }catch{
    const error=new Error('The stored script could not be decrypted. Restore the original SCRIPT_ENCRYPTION_KEY in Railway; do not generate a different value on redeploy.');error.status=503;throw error;
  }
}
