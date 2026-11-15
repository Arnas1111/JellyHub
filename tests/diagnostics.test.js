import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, requestContext, upstreamFailure,readValidationFields } from '../diagnostics.js';

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
test('validation diagnostics identify rejected search parameters without echoing values or credentials',async()=>{
  const fields=await readValidationFields(new Response(JSON.stringify({errors:[{path:'.query.query',message:'must match URL encoding format',value:'private search'},{path:'.query.page',message:'must be a number'},{path:'.headers.X-Api-Key',message:'private-key'}]})));assert.deepEqual(fields,[{field:'query',issue:'invalid format'},{field:'page',issue:'must be a number'}]);const diagnostic=upstreamFailure({status:400,code:'HTTP_ERROR',validation:fields});assert.match(diagnostic.message,/query: invalid format/);assert.match(diagnostic.hint,/API parameters/);assert.doesNotMatch(JSON.stringify(diagnostic),/private search|private-key|X-Api-Key/);assert.deepEqual(await readValidationFields(new Response('not JSON')),[]);
});
