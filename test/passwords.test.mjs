import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp,bootstrap } from '../cloud/app.mjs';
import { MemoryRepository } from './cloud-memory.mjs';
import { passwordHash,verifyPassword } from '../cloud/auth.mjs';

test('short passwords work for initial admin, user creation, changes and admin resets',async()=>{
 const repo=new MemoryRepository();await bootstrap(repo,'admin','7');
 const server=createApp(repo);server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const request=async(path,token='',data)=>{const response=await fetch(origin+'/api/'+path,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});return{status:response.status,...await response.json()};};
 try{
  const admin=await request('login','',{username:'admin',password:'7'});assert.equal(admin.status,200);
  const created=await request('admin/users',admin.token,{username:'alice',password:'ab'});assert.equal(created.status,201);
  const alice=await request('login','',{username:'alice',password:'ab'});assert.equal(alice.status,200);
  assert.equal((await request('password',alice.token,{currentPassword:'ab',password:'c'})).status,200);
  assert.equal((await request('me',alice.token)).status,401);
  const changed=await request('login','',{username:'alice',password:'c'});assert.equal(changed.status,200);
  assert.equal((await request('admin/users/update',admin.token,{id:created.user.id,password:''})).status,400);
  assert.equal((await request('admin/users/update',admin.token,{id:created.user.id,password:'d'})).status,200);
  assert.equal((await request('me',changed.token)).status,401);
  assert.equal((await request('login','',{username:'alice',password:'d'})).status,200);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('empty/oversized passwords stay invalid and hashing preserves exact short passwords',async()=>{
 for(const password of ['',null,undefined,'x'.repeat(129)])await assert.rejects(passwordHash(password),/password/);
 const hash=await passwordHash('a');assert.match(hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.equal(await verifyPassword('a',hash),true);assert.equal(await verifyPassword('A',hash),false);
});
