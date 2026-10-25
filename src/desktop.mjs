import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let active = null;
export function notifyCaptured({ count, added }) {
  if (process.platform !== 'win32') return;
  // Replace an older popup immediately instead of delaying a new capture notice.
  if (active) { active.kill(); active = null; }
  const payload = JSON.stringify({ title: 'Links captured and decoded', message: count + ' matching links saved on this PC. You can continue.\n' + added + ' new. Cloud sync continues in background.' });
  const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./notify.ps1', import.meta.url))], { windowsHide: true, stdio: ['pipe','ignore','ignore'] });
  active = child;
  child.stdin.on('error', () => {}); child.stdin.end(payload);
  child.on('error', () => { if (active === child) active = null; });
  child.on('close', () => { if (active === child) active = null; });
}
