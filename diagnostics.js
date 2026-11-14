import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext=new AsyncLocalStorage();
export const logLevels=['silent','error','warn','info','debug'];
export function createLogger(initial='info',write=line=>console.log(line)){
  let level=logLevels.includes(initial)?initial:'info';
  return {
    get level(){return level},
    setLevel(value){if(!logLevels.includes(value))throw new Error('Invalid log level');level=value},
    // Callers supply allowlisted metadata only. Never pass headers, bodies or raw errors.
    log(severity,event,details={}){
      if(level==='silent'||logLevels.indexOf(severity)>logLevels.indexOf(level))return;
      write(JSON.stringify({time:new Date().toISOString(),level:severity,event,requestId:requestContext.getStore()?.requestId,...details}));
    }
  };
}

export function upstreamFailure({endpoint,status,code,method,durationMs,keyConfigured,requestId}){
  let hint='Check the service URL and Docker network connectivity.';
  if(code==='MISSING_API_KEY')hint='Enter the API key from the service’s Settings → General → Security. A blank field uses the saved key. Test connection uses the current form without saving.';
  else if(status===401||status===403)hint='The service rejected authentication. Verify the API key from Settings → General → Security, the service URL, and any reverse-proxy authentication. A web login password is not the API key.';
  else if(status>=300&&status<400)hint='The service redirected this request. Use its direct internal URL and correct URL base; credentials are not forwarded to redirects.';
  else if(status===404)hint='Check the service URL, URL base and API version. This adapter uses /api/v3 for Sonarr/Radarr.';
  else if(code==='ENOTFOUND'||code==='EAI_AGAIN')hint='Docker DNS could not resolve the hostname. Check the container name and that JellyHub can reach it on docker_external.';
  else if(code==='ECONNREFUSED')hint='The host refused the connection. Check the internal container port and whether the service is running.';
  else if(code==='TIMEOUT')hint='The service did not respond before the timeout. Check its health and network access.';
  else if(code==='INVALID_RESPONSE')hint='Expected JSON but received another response. Check for a proxy login page, wrong URL base or wrong port.';
  else if(code?.includes('CERT')||code?.includes('TLS'))hint='TLS certificate validation failed. Use a trusted certificate or the direct internal HTTP address; certificate checks are not disabled.';
  const message=code==='MISSING_API_KEY'?'No API key is configured for this connection.':code==='HTTP_ERROR'&&status?`Service returned HTTP ${status}.`:`Service request failed (${code}).`;
  return {message,hint,endpoint,method,code,httpStatus:status||null,keyConfigured,durationMs,requestId};
}
