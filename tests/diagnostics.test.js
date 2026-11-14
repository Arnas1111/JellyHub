import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, requestContext, upstreamFailure } from '../diagnostics.js';

test('log levels filter structured records and request IDs correlate events',()=>{
  const lines=[];const logger=createLogger('warn',line=>lines.push(JSON.parse(line)));
  logger.log('debug','hidden');logger.log('info','hidden');logger.log('warn','visible');
  assert.deepEqual(lines.map(line=>line.event),['visible']);
  logger.setLevel('debug');requestContext.run({requestId:'test-id'},()=>logger.log('debug','upstream.completed',{httpStatus:200}));
  assert.equal(lines.at(-1).requestId,'test-id');assert.equal(lines.at(-1).httpStatus,200);
  logger.setLevel('silent');logger.log('error','hidden');assert.equal(lines.length,2);
  assert.throws(()=>logger.setLevel('invalid'));
});

test('network diagnostics distinguish DNS, refused connections, timeout and TLS failures',()=>{
  for(const [code,hint] of [['ENOTFOUND',/DNS/],['ECONNREFUSED',/refused/],['TIMEOUT',/timeout/],['CERT_HAS_EXPIRED',/certificate/]]){
    const result=upstreamFailure({endpoint:'http://sonarr:8989/api/v3/system/status',code,method:'GET',durationMs:5,keyConfigured:true});
    assert.match(result.hint,hint);assert.equal(result.code,code);assert.equal(result.httpStatus,null);
  }
});
