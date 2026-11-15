// A connection carries invalidations only. Messages still use the authenticated room API.
export function createChatEvents({authorize,canRead,isActive=()=>true}){
  const clients=new Set();
  function connect(res,user){
    if(clients.size>=256||[...clients].filter(client=>client.user.id===user.id).length>=4)throw Object.assign(Error('Too many live chat connections.'),{status:429});
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'private, no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff','Vary':'Cookie'});res.flushHeaders?.();
    const client={res,user,work:Promise.resolve()};clients.add(client);
    const close=()=>{clearInterval(heartbeat);clients.delete(client);res.end()};
    client.close=close;client.write=(event,data)=>{if(!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))close()};
    function schedule(work){client.work=client.work.then(async()=>{if(!clients.has(client))return;if(!isActive(user)){client.write('blocked',{});return close()}await authorize(user);await work()}).catch(error=>{if(clients.has(client)){if([401,403,404].includes(error.status))client.write('blocked',{});close()}})}
    client.schedule=schedule;
    const heartbeat=setInterval(()=>schedule(()=>{if(!res.write(': keep-alive\n\n'))close()}),25000);heartbeat.unref?.();res.on('close',close);
    client.write('ready',{});
  }
  function notify(roomIds=[],rooms=false,reset=false){for(const client of clients){
    if(!rooms&&!reset&&!roomIds.some(id=>canRead(id,client.user)))continue;
    client.pending||={roomIds:new Set(),rooms:false,reset:false};for(const id of roomIds)client.pending.roomIds.add(id);client.pending.rooms||=rooms;client.pending.reset||=reset;
    if(client.notifying)continue;client.notifying=true;client.schedule(()=>{
      const pending=client.pending;client.pending=null;client.notifying=false;const visible=[...pending.roomIds].filter(id=>canRead(id,client.user));if(visible.length||pending.rooms||pending.reset)client.write('change',{roomIds:visible,rooms:pending.rooms,reset:pending.reset});
    });
  }}
  return {connect,notify,close(){for(const client of clients)client.close()}};
}
