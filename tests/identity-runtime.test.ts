import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readdir, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DshClient, discover } from '../src/plugin/dsh.ts';
import { migrateLegacyData } from '../src/plugin/legacy-migration.ts';
import { messagesResponse } from './fixtures/messages.ts';

const pixel='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';

async function snapshot(root:string, prefix=''):Promise<Map<string,Buffer>> {
  const result=new Map<string,Buffer>();
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
    const path=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isDirectory())for(const [name,bytes] of await snapshot(root,path))result.set(name,bytes);
    else result.set(path,await readFile(join(root,path)));
  }
  return result;
}

test('renamed plugin resumes real DSH history and image objects from the migrated directory', {timeout:60000}, async()=>{
  const env=discover();
  await mkdir('.runs',{recursive:true});
  const dir=await mkdtemp(resolve('.runs/identity-runtime-'));
  const home=join(dir,'config'),pluginsDirectory=join(dir,'.obsidian/plugins');
  const legacy=join(pluginsDirectory,'deepsidian'),destination=join(pluginsDirectory,'deepseedian');
  await mkdir(home);await writeFile(join(home,'settings.yaml'),'{}');
  await mkdir(legacy,{recursive:true});
  const requests:any[]=[],errors:unknown[]=[];
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      // The real adapter probes Files support before falling back to inline images.
      if(req.url==='/v1/files'){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":{"message":"Files unsupported by local fixture"}}');return;}
      assert.equal(req.url,'/v1/messages');
      requests.push(JSON.parse(raw));
      messagesResponse(res,{text:requests.length===1?'IDENTITY-ORIGINAL-ANSWER':'IDENTITY-RESUMED-ANSWER'});
    }catch(error){errors.push(error);res.writeHead(500);res.end('Synthetic identity migration fixture failed');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const oldUrl=process.env.DEEPSEEK_BASE_URL,oldKey=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${(server.address() as any).port}`;
  process.env.DEEPSEEK_API_KEY='synthetic-local-key';
  const options={packageRoot:env.root,nodePath:env.node,dshHome:home,runtimeHome:join(legacy,'.runtime'),bridgePath:resolve('src/plugin/bridge.mjs'),cwd:resolve('fixtures'),provider:'deepseek-official',model:'deepseek-flash',maxTokens:2048};
  const tool=async()=>{throw Error('No tools expected');};
  let client=new DshClient(options,tool,()=>{});
  const id=randomUUID(),savedLegacy=join(dir,'preserved-legacy-plugin');
  let legacyTemporarilyMoved=false;
  try{
    assert.equal((await client.prompt(id,'IDENTITY-ORIGINAL-QUESTION',[{name:'pixel.png',mimeType:'image/png',data:pixel}])).kind,'completed');
    await client.stop();
    const original=await snapshot(legacy);
    const objects=[...original].filter(([path])=>path.startsWith('.runtime/attachments/'));
    assert.ok(objects.length>0,'DSH must persist attachment objects in the legacy directory');
    assert.equal(await migrateLegacyData({pluginsDirectory,destination,legacyEnabled:false}),'migrated');
    for(const [path,bytes] of objects)assert.deepEqual(await readFile(join(destination,path)),bytes,`Migrated attachment: ${path}`);
    assert.deepEqual(await snapshot(legacy),original,'Migration must leave every legacy file unchanged');

    // Remove access to the original path without deleting its data. A stale absolute
    // attachment reference must not accidentally make this continuation pass.
    await rename(legacy,savedLegacy);legacyTemporarilyMoved=true;
    client=new DshClient({...options,runtimeHome:join(destination,'.runtime')},tool,()=>{});
    assert.equal((await client.prompt(id,'IDENTITY-AFTER-RENAME')).kind,'completed');
    await client.stop();
    assert.equal(requests.length,2);
    const replay=requests[1].messages;
    for(const expected of ['IDENTITY-ORIGINAL-QUESTION','IDENTITY-ORIGINAL-ANSWER','IDENTITY-AFTER-RENAME'])assert.ok(JSON.stringify(replay).includes(expected),expected);
    const images=replay.flatMap((message:any)=>Array.isArray(message.content)?message.content:[]).filter((block:any)=>block.type==='image');
    assert.equal(images.length,1,'The old image must reach the resumed model request');
    assert.equal(images[0].source.type,'base64');
    assert.equal(images[0].source.media_type,'image/png');
    assert.deepEqual(Buffer.from(images[0].source.data,'base64'),Buffer.from(pixel,'base64'));
    for(const [path,bytes] of objects)assert.deepEqual(await readFile(join(destination,path)),bytes);
    assert.deepEqual(await snapshot(savedLegacy),original,'Continuation must not modify preserved legacy data');
    assert.deepEqual(errors,[]);
  }finally{
    await client.stop();
    if(legacyTemporarilyMoved)await rename(savedLegacy,legacy);
    server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
    oldUrl===undefined?delete process.env.DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL=oldUrl;
    oldKey===undefined?delete process.env.DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY=oldKey;
  }
});
