const fs=require('fs');
const p='src/lib/setup-sql.js';
const lines=fs.readFileSync(p,'utf8').split(/\r?\n/);
let open=0;
const out=[];
for(const ln of lines){
  if(/^DO \$\$\s*$/.test(ln)){ open++; out.push(ln); continue; }
  if(/^END \$\$;\s*$/.test(ln)){
    if(open>0){ open--; out.push(ln); }
    continue;
  }
  out.push(ln);
}
fs.writeFileSync(p,out.join('\n'));
console.log('removed stray END $$; lines');
