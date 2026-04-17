const fs = require('fs');
const path = 'src/lib/setup-sql.js';
let lines = fs.readFileSync(path,'utf8').split(/\r?\n/);

function parseCreateTables(linesArr){
  const map=new Map();
  for(let i=0;i<linesArr.length;i++){
    const m=linesArr[i].match(/^CREATE TABLE IF NOT EXISTS\s+([^\s(]+)\s*\(/i);
    if(!m) continue;
    const tbl=m[1];
    let depth=0, started=false, end=i;
    for(let j=i;j<linesArr.length;j++){
      for(const ch of linesArr[j]){ if(ch==='('){depth++;started=true;} else if(ch===')'){depth--;}}
      if(started && depth===0 && /\);\s*$/.test(linesArr[j])){ end=j; break; }
    }
    map.set(tbl,{start:i,end}); i=end;
  }
  return map;
}

function injectConstraint(linesArr,tbl,cname,cdef){
  const map=parseCreateTables(linesArr); const meta=map.get(tbl); if(!meta) return false;
  for(let i=meta.start;i<=meta.end;i++){ if(new RegExp(`\\bCONSTRAINT\\s+"?${cname}"?\\b`,'i').test(linesArr[i])) return true; }
  let prev=meta.end-1; while(prev>meta.start && linesArr[prev].trim()==='') prev--;
  if(!linesArr[prev].trim().endsWith(',')) linesArr[prev]=linesArr[prev]+',';
  linesArr.splice(meta.end,0,`  CONSTRAINT ${cname} ${cdef}`);
  return true;
}

function applyAlterColumn(linesArr,tbl,col,kind,expr){
  const map=parseCreateTables(linesArr); const meta=map.get(tbl); if(!meta) return false;
  const re=new RegExp(`^\\s*"?${col}"?\\s+`,'i');
  for(let i=meta.start+1;i<meta.end;i++){
    if(!re.test(linesArr[i])) continue;
    let ln=linesArr[i];
    const hasComma=/,\s*$/.test(ln);
    let core=ln.replace(/,\s*$/,'').trimEnd();
    if(kind==='notnull' && !/\bNOT\s+NULL\b/i.test(core)) core += ' NOT NULL';
    if(kind==='default' && !/\bDEFAULT\b/i.test(core)) core += ` DEFAULT ${expr}`;
    linesArr[i] = hasComma ? `${core},` : core;
    return true;
  }
  return false;
}

for(let i=0;i<lines.length;i++){
  if(!/^DO \$\$\s*$/.test(lines[i])) continue;
  let end=-1; for(let j=i+1;j<lines.length;j++){ if(/^END \$\$;\s*$/.test(lines[j])) {end=j;break;} }
  if(end===-1) continue;
  const blockLines=lines.slice(i,end+1);
  const block=blockLines.join('\n');

  // single ADD CONSTRAINT blocks
  if(/ALTER TABLE/i.test(block) && /ADD CONSTRAINT/i.test(block) && /WHEN duplicate_object/i.test(block) && !/DROP CONSTRAINT/i.test(block)){
    const t=block.match(/ALTER TABLE\s+([^\s]+)/i);
    const c=block.match(/ADD CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?\s+([\s\S]*?);/i);
    if(t&&c){
      const tbl=t[1].trim();
      const cname=c[1].trim();
      const cdef=c[2].replace(/\n\s+/g,' ').trim();
      if(injectConstraint(lines,tbl,cname,cdef)) { lines.splice(i,end-i+1); i--; continue; }
    }
  }

  // single ALTER COLUMN SET NOT NULL / DEFAULT blocks
  if(/ALTER TABLE/i.test(block) && /ALTER COLUMN/i.test(block) && /WHEN others/i.test(block)){
    let m=block.match(/ALTER TABLE\s+([^\s]+)[\s\S]*?ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+NOT\s+NULL\s*;/i);
    if(m){ if(applyAlterColumn(lines,m[1].trim(),m[2],'notnull')){ lines.splice(i,end-i+1); i--; continue; } }
    m=block.match(/ALTER TABLE\s+([^\s]+)[\s\S]*?ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+DEFAULT\s+(.+?)\s*;/i);
    if(m){ if(applyAlterColumn(lines,m[1].trim(),m[2],'default',m[3])){ lines.splice(i,end-i+1); i--; continue; } }
  }
}

// direct ALTER TABLE ... ALTER COLUMN ... lines
for(let i=0;i<lines.length;i++){
  let m=lines[i].match(/^ALTER TABLE\s+([^\s]+)\s+ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+NOT\s+NULL;\s*$/i);
  if(m){ if(applyAlterColumn(lines,m[1].trim(),m[2],'notnull')){ lines.splice(i,1); i--; continue; } }
  m=lines[i].match(/^ALTER TABLE\s+([^\s]+)\s+ALTER COLUMN\s+"?([a-zA-Z0-9_]+)"?\s+SET\s+DEFAULT\s+(.+);\s*$/i);
  if(m){ if(applyAlterColumn(lines,m[1].trim(),m[2],'default',m[3])){ lines.splice(i,1); i--; continue; } }
}

fs.writeFileSync(path, lines.join('\n'));
console.log('squash script done');
