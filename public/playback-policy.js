// Native HLS may fetch the opening segments before applying a resume seek.
// Prefer HLS.js where supported, and give Jellyfin time to start its transcoder.
export function hlsLoadPolicies(Hls){
  return Object.fromEntries(['manifestLoadPolicy','playlistLoadPolicy','fragLoadPolicy'].map(key=>[key,{default:{...Hls.DefaultConfig[key].default,maxTimeToFirstByteMs:65000,maxLoadTimeMs:120000}}]));
}
