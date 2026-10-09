import test from 'node:test';
import assert from 'node:assert/strict';
import {soulAvatarImage} from './soul-avatar-source.ts';

void test('published owner photo wins over body capture; failure and removal preserve generated fallback',()=>{
 const id='s_profile',hash='a'.repeat(64),url=`/w/eden/v1/souls/${id}/profile-photo/${hash}`;
 const soul={id,profilePhoto:{hash,url,mime:'image/png' as const,width:96,height:96,bytes:800}};
 const body='data:image/png;base64,actualBodyCapture';
 const selected=soulAvatarImage(soul,'/w/eden',body,null)!;
 assert.equal(selected.kind,'profile-photo');assert.equal(selected.src,url);assert.equal(selected.hash,hash);
 assert.equal(soulAvatarImage(soul,'/w/eden',body,selected.key)?.src,body);
 assert.equal(soulAvatarImage({id},'/w/eden',body,null)?.kind,'generated');
 assert.equal(soulAvatarImage({id},'/w/eden',undefined,null),undefined);
 const nextHash='b'.repeat(64),next={...soul,profilePhoto:{...soul.profilePhoto,hash:nextHash,url:url.replace(hash,nextHash)}};
 assert.equal(soulAvatarImage(next,'/w/eden',body,selected.key)?.kind,'profile-photo','a newer photo can load after the old one failed');
 for(const photo of [{...soul.profilePhoto,url:url.replace(id,'s_other')},{...soul.profilePhoto,url:url.replace('/w/eden','/w/mars')},{...soul.profilePhoto,url:'https://untrusted.example/photo.png'},{...soul.profilePhoto,width:513}])
  assert.equal(soulAvatarImage({id,profilePhoto:photo},'/w/eden',body,null)?.kind,'generated','invalid or cross-Soul/world data never replaces the body portrait');
});
