const fs=require('fs');
const diff=fs.readFileSync('_setup_sql.diff','utf8').split(/\r?\n/);
const cur=fs.readFileSync('src/lib/setup-sql.js','utf8').split(/\r?\n/);
function parseCreate(lines){
 const map=new Map();
 for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^CREATE TABLE IF NOT EXISTS\s+([^\s(]+)\s*\(/i);
  if(!m) continue;
  const tbl=m[1];
  let depth=0,start=i,end=i,started=false;
  for(let j=i;j<lines.length;j++){
   for(const ch of lines[j]){if(ch==='('){depth++;started=true;} else if(ch===')') depth--;}
   if(started && depth===0 && /\);\s*$/.test(lines[j])){end=j;break;}
  }
  map.set(tbl,{start,end,body:lines.slice(start,end+1).join('\n')});
  i=end;
 }
 return map;
}
const creates=parseCreate(cur);
let table=null;const deletedCols=[];
for(const l of diff){
 if(!l.startsWith('-')||l.startsWith('---')) continue;
 const s=l.slice(1);
 const mt=s.match(/^ALTER TABLE\s+([^\s]+)\s*$/i); if(mt){table=mt[1];continue;}
 const mc=s.match(/^\s*ADD COLUMN IF NOT EXISTS\s+"?([a-zA-Z0-9_]+)"?/i); if(mc&&table){deletedCols.push({table,col:mc[1]});}
}
const missing=[];
for(const x of deletedCols){
 const c=creates.get(x.table); if(!c){missing.push({...x,reason:'table_missing'}); continue;}
 const re=new RegExp(`(^|\\n)\\s*"?${x.col}"?\\s+`,'i');
 if(!re.test(c.body)) missing.push({...x,reason:'col_missing'});
}
console.log('deleted add-column entries:',deletedCols.length);
console.log('missing from current create:',missing.length);
if(missing.length) console.log(JSON.stringify(missing,null,2));
