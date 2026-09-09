'use strict';
const WORKER_URL = process.env.WORKER_URL || 'http://109.94.1.210:3100/scrape';
const CLOAK_WORKER_URL = process.env.CLOAK_WORKER_URL || 'http://109.94.1.210:3101/scrape';
const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'http://109.94.1.210:3002';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const TOOLS = [
  { name: 'scrape_url', description: 'Антидетект-воркер (Camoufox). Возвращает status, title и текст-выдержку.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, timeout: { type: 'number', default: 90 } }, required: ['url'] } },
  { name: 'scrape_markdown', description: 'Скрейп через Firecrawl в markdown.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, timeout: { type: 'number', default: 90 } }, required: ['url'] } },
  { name: 'scrape_wb', description: 'Товары с Wildberries по запросу через его фирменный поиск (цена, скидка, рейтинг, отзывы, ссылка). NB: WB режет 429 — тул сам ретраит. Без антибота благодаря использованию WB API.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Поисковый запрос, например «принтер»' }, limit: { type: 'number', description: 'Сколько позиций вернуть, по умолчанию 10, макс 30', default: 10 } }, required: ['query'] } },
  { name: 'scrape_cloak', description: 'Скрейп через CloakBrowser (stealth-Chromium). Проходит Cloudflare/Turnstile и «403» там, где Camoufox пасует (DNS-шоп и т.п.).', inputSchema: { type: 'object', properties: { url: { type: 'string' }, timeout: { type: 'number', default: 90 } }, required: ['url'] } },
  { name: 'scrape_ozon', description: 'Товары с Ozon по запросу (название + ссылка) через воркер. ВНИМАНИЕ: Ozon цены в открытом API не отдаёт (отдельный микрофронтенд), поэтому цены в ответе НЕ будет.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Поисковый запрос, например «смартфон»' }, limit: { type: 'number', description: 'Сколько позиций вернуть, по умолчанию 5, макс 10', default: 5 } }, required: ['query'] } }
];
function t(html, limit) { limit = limit || 30000; let s = String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/\{[^}]*\}/g,' ').replace(/--[\w-]+:\s*[^;{}]*;/g,' ').replace(/\[data-[a-z-]*="[^"]*"\]/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return s.slice(0,limit); }
async function post(u,p,ms,tk){const h={'Content-Type':'application/json'};if(tk)h['x-api-token']=tk;const c=new AbortController();const x=setTimeout(()=>c.abort(),ms||90000);try{const r=await fetch(u,{method:'POST',headers:h,body:JSON.stringify(p),signal:c.signal});const q=await r.text();let d={};try{d=JSON.parse(q);}catch(e){d={raw:q};}return{status:r.status,data:d};}finally{clearTimeout(x);}}
async function scrapeAt(base,url,to){const m=(to||90)*1000;try{const{status,data}=await post(base,{url,timeout_ms:m},m,AUTH_TOKEN);if(status!==200)return{isError:true,content:[{type:'text',text:'HTTP '+status+': '+JSON.stringify(data).slice(0,300)}]};if(!data.ok)return{isError:true,content:[{type:'text',text:JSON.stringify(data).slice(0,2000)}]};const title=String(data.title||'').replace(/\s+/g,' ').trim();const text=t(data.html||'');return{isError:false,content:[{type:'text',text:'status: ok\nurl: '+data.url+'\ntitle: '+title+'\n\ntext:\n'+text}]};}catch(e){return{isError:true,content:[{type:'text',text:'worker error: '+e.message}]};}}
const scrape=(url,to)=>scrapeAt(WORKER_URL,url,to);
const scrapeCloak=(url,to)=>scrapeAt(CLOAK_WORKER_URL,url,to);
async function ozonSearch(query, limit){
  const n=Math.max(1,Math.min(parseInt(limit||5,10)||5,10));
  const q=String(query||'').trim();
  if(!q) return {isError:true,content:[{type:'text',text:'query обязателен'}]};
  const url='https://www.ozon.ru/search/?text='+encodeURIComponent(q);
  try{
    const {status,data}=await post(WORKER_URL,{url,timeout_ms:60000},75000,AUTH_TOKEN);
    if(status!==200) return {isError:true,content:[{type:'text',text:'HTTP '+status}]};
    if(!data.ok) return {isError:true,content:[{type:'text',text:JSON.stringify(data).slice(0,1200)}]};
    const html=data.html||'';
    const links=[...new Set([...html.matchAll(/href="\/product\/([^"]+)/g)].map(m=>m[1].split('?')[0]))].slice(0,n);
    if(!links.length) return {isError:true,content:[{type:'text',text:'товары не найдены (Ozon не отдал карточки)'}]};
    const rows=links.map((s,i)=>{
      const t=s.replace(/-\d+$/,'').replace(/-/g,' ').replace(/смартфон\s+/i,'');
      return (i+1)+'. '+t.replace(/\b\w/g,c=>c.toUpperCase())+'\n   https://www.ozon.ru/product/'+s;
    });
    return {isError:false,content:[{type:'text',text:'Ozon — «'+q+'», топ '+links.length+':\n'+rows.join('\n')+'\n\nP.S. цен тут нет: Ozon держит их в закрытом microfrontend.'}]};
  }catch(e){return {isError:true,content:[{type:'text',text:'ozon error: '+e.message}]};}
}
async function md(url,to){const m=(to||90)*1000;try{const{status,data}=await post(FIRECRAWL_URL+'/v2/scrape',{url,formats:['markdown'],timeout:m},m,AUTH_TOKEN);const z=(data&&data.data&&data.data.markdown)||null;if(!z)return{isError:true,content:[{type:'text',text:'firecrawl: '+JSON.stringify(data).slice(0,2000)}]};return{isError:false,content:[{type:'text',text:z.slice(0,6000)}]};}catch(e){return{isError:true,content:[{type:'text',text:'firecrawl error: '+e.message}]};}}
async function wbSearch(query, limit){
  const n=Math.max(1,Math.min(parseInt(limit||10,10)||10,30));
  const enc=encodeURIComponent(String(query||'').trim());
  if(!enc) return {isError:true,content:[{type:'text',text:'query обязателен'}]};
  const url='https://search.wb.ru/exactmatch/ru/common/v5/search?appType=1&curr=rub&dest=-1257786&page=1&query='+enc+'&resultset=catalog&sort=popular&spp=30&suppressSpellcheck=false';
  const hd={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36','Referer':'https://www.wildberries.ru/'};
  let last='';
  for(let attempt=0;attempt<6;attempt++){
    try{
      const c=new AbortController();const x=setTimeout(()=>c.abort(),25000);
      const r=await fetch(url,{headers:hd,signal:c.signal});clearTimeout(x);
      if(r.status===429){last='WB 429 rate-limit, повтор';await new Promise(q=>setTimeout(q,10000*(attempt+1)));continue;}
      const j=await r.json();
      const ps=(j&&j.products)||[];
      if(!ps.length){last='WB вернул пустую выдачу по «'+query+'» (возможно rate-limit)';continue;}
      const rows=ps.slice(0,n).map((p)=>{
        const pr=((p.sizes&&p.sizes[0]&&p.sizes[0].price)||{});
        const basic=pr.basic||0, fin=pr.product||0;
        const disc=basic?Math.round((1-fin/basic)*100):0;
        return ((p.name||'')+' | '+Math.round(fin/100)+' ₽ | скидка '+disc+'% | рейтинг '+(p.reviewRating||p.rating||0)+' | отзывов '+(p.feedbacks||0)+' | https://www.wildberries.ru/catalog/'+p.id+'/detail.aspx');
      });
      return {isError:false,content:[{type:'text',text:'Wildberries — «'+query+'» ('+ps.length+' в выдаче), топ '+rows.length+':\n'+(rows.join('\n'))}]};
    }catch(e){last='ошибка: '+e.message;await new Promise(q=>setTimeout(q,8000));}
  }
  return {isError:true,content:[{type:'text',text:'wildberries: '+last}]};
}
const i=process.stdin,o=process.stdout;let b=Buffer.alloc(0);
function r(){const x=b.indexOf('\r\n\r\n');if(x!==-1){const h=b.slice(0,x).toString('utf8');let n=0;for(const l of h.split('\r\n')){const m=/^content-length:\s*(\d+)$/i.exec(l);if(m)n=parseInt(m[1],10);}if(n>0&&b.length>=x+4+n){const y=b.slice(x+4,x+4+n).toString('utf8');b=b.slice(x+4+n);try{return JSON.parse(y);}catch(e){return null;}}}const nl=b.indexOf(0x0a);if(nl!==-1){const c=b.slice(0,nl).toString('utf8').trim();if(c.startsWith('{')){try{const o=JSON.parse(c);b=b.slice(nl+1);return o;}catch(e){return null;}}}return null;}
function w(o){const d=Buffer.from(JSON.stringify(o),'utf8');process.stdout.write(Buffer.concat([d,Buffer.from('\n','utf8')]));}
i.on('data',(c)=>{b=Buffer.concat([b,c]);let m;while((m=r())!==null){h(m).then(()=>{},()=>{});}});
async function h(m){const me=m.method,id=m.id;if(me==='initialize'){w({jsonrpc:'2.0',id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'firecrawl-stack',version:'1.1.0'}}});}else if(me==='ping'){if(id!==undefined&&id!==null)w({jsonrpc:'2.0',id,result:{}});}else if(me==='tools/list'){w({jsonrpc:'2.0',id,result:{tools:TOOLS}});}else if(me==='tools/call'){const p=m.params||{},nm=p.name,a=p.arguments||{};let rs;if(nm==='scrape_url')rs=await scrape(a.url||'',parseInt(a.timeout||90,10));else if(nm==='scrape_cloak')rs=await scrapeCloak(a.url||'',parseInt(a.timeout||90,10));else if(nm==='scrape_markdown')rs=await md(a.url||'',parseInt(a.timeout||90,10));else if(nm==='scrape_wb')rs=await wbSearch(a.query||'',parseInt(a.limit||10,10));else if(nm==='scrape_ozon')rs=await ozonSearch(a.query||'',parseInt(a.limit||5,10));else rs={isError:true,content:[{type:'text',text:'unknown tool: '+nm}]};w({jsonrpc:'2.0',id,result:rs});}else if(id!==undefined&&id!==null){w({jsonrpc:'2.0',id,result:{}});}}
i.on('end',()=>{});