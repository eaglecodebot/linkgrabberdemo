import { MongoClient } from 'mongodb';
import { Repository } from './repository.mjs';
import { createApp, bootstrap } from './app.mjs';
const { MONGODB_URI, MONGODB_DB = 'link_grabber', ADMIN_USERNAME, ADMIN_PASSWORD, PUBLIC_URL } = process.env;
if (!MONGODB_URI || !ADMIN_USERNAME || !ADMIN_PASSWORD || !PUBLIC_URL) throw new Error('Set MONGODB_URI, MONGODB_DB, ADMIN_USERNAME, ADMIN_PASSWORD and PUBLIC_URL.');
if (ADMIN_PASSWORD.includes('REPLACE_WITH_')) throw new Error('Replace the example administrator password with your own random password.');
const origin = new URL(PUBLIC_URL).origin;
if (!origin.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin)) throw new Error('PUBLIC_URL must use HTTPS.');
const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000, writeConcern: { w: 'majority' } });
await client.connect(); const repo = new Repository(client.db(MONGODB_DB)); await repo.initialize(); await bootstrap(repo, ADMIN_USERNAME, ADMIN_PASSWORD);
if(!/^[a-f0-9]{64}$/i.test(process.env.SCRIPT_ENCRYPTION_KEY||''))console.warn('Set a fixed SCRIPT_ENCRYPTION_KEY in Railway to enable permanent script copying. Existing history remains available.');
const server = createApp(repo, { publicOrigin: origin, trustProxy: process.env.RAILWAY_ENVIRONMENT_ID !== undefined, scriptSecret:process.env.SCRIPT_ENCRYPTION_KEY });
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Link Grabber cloud backend ready.'));
async function stop() { server.close(async () => { await client.close(); process.exit(0); }); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
