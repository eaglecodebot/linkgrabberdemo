import test from 'node:test';
import assert from 'node:assert/strict';
import {sealScript,openScript} from '../cloud/script-vault.mjs';
import {createCaptureScript} from '../cloud/capture.mjs';
import {MemoryRepository} from './cloud-memory.mjs';

const secret='12'.repeat(32),record={_id:'alice',authVersion:1,revision:'first'};
test('script encryption is recoverable, randomized and bound to user/version; wrong keys fail',()=>{
 const script='private script for account alice, secret abc123';
 const a={...record,ciphertext:sealScript(script,record,secret)},b={...record,ciphertext:sealScript(script,record,secret)};
 assert.notEqual(a.ciphertext,b.ciphertext);assert(!a.ciphertext.includes(script));assert.equal(openScript(a,secret),script);
 assert.throws(()=>openScript(a,'34'.repeat(32)),/original SCRIPT_ENCRYPTION_KEY/);
 assert.throws(()=>openScript({...a,_id:'bob'},secret),/decrypted/);
 assert.throws(()=>openScript({...a,authVersion:2},secret),/decrypted/);
 assert.throws(()=>sealScript(script,record,''),/SCRIPT_ENCRYPTION_KEY/);
});
test('missing/wrong deployment secret never replaces an existing permanent script',async()=>{
 const repo=new MemoryRepository(),user={_id:'alice',username:'alice',name:'Alice',active:true,authVersion:1};await repo.addUser(user);await repo.saveSettings(user._id,{pagePattern:'https://source.test/*',minLinks:4});
 await assert.rejects(createCaptureScript(repo,user,'https://panel.test',''),/SCRIPT_ENCRYPTION_KEY/);assert.equal(repo.permanentScripts.size,0);
 const first=await createCaptureScript(repo,user,'https://panel.test',secret),stored=structuredClone(await repo.permanentScript(user._id));
 await assert.rejects(createCaptureScript(repo,user,'https://panel.test','34'.repeat(32)),/original SCRIPT_ENCRYPTION_KEY/);
 assert.deepEqual(await repo.permanentScript(user._id),stored);
 assert.equal((await createCaptureScript(repo,user,'https://panel.test',secret)).script,first.script);
});
