import { scrypt as scryptCallback, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export function username(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,60}$/.test(name)) throw new Error('Username must be 3–60 letters, digits, dots, underscores or hyphens.');
  return name;
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password with 12–128 characters.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + Buffer.from(await scrypt(password, salt, 64)).toString('hex');
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, value] = hash.split(':');
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(value, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const safeUser = u => ({ id: u._id, username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt });
export function ownerFor(user, requested) {
  if (requested && (typeof requested !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requested))) throw new Error('Invalid user ID.');
  if (requested && requested !== user._id && user.role !== 'admin') {
    const error = new Error('You can only access your own history.'); error.status = 403; throw error;
  }
  return requested || user._id;
}
