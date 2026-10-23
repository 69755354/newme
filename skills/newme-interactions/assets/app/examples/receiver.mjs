import http from 'node:http';
http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/feedback'){res.writeHead(404);res.end();return;}
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){res.writeHead(413);res.end();req.destroy();return;}chunks.push(chunk);}
  try{const event=JSON.parse(Buffer.concat(chunks).toString('utf8'));console.log('Received feedback event:',event.id);res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({accepted:true,executed:false}));}
  catch{res.writeHead(400);res.end();}
}).listen(4321,'127.0.0.1',()=>console.log('Example receiver: http://127.0.0.1:4321/feedback (no AI execution)'));
