package dashboard

// pageHTML is the single-page dashboard: plain HTML + a little vanilla JS that
// polls the JSON API. No framework, no build step. Dark by default.
const pageHTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mirage</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --card:#171c24; --fg:#e6edf3;
          --mut:#8b949e; --line:#232a34; --ok:#2ea043; --warn:#d29922; --bad:#f85149; --accent:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex;
           align-items:center; gap:14px; }
  header h1 { font-size:18px; margin:0; letter-spacing:.5px; }
  .pill { font-size:11px; padding:2px 8px; border-radius:10px; border:1px solid var(--line); color:var(--mut); }
  main { padding:16px 20px; display:grid; gap:20px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--mut); margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mut); font-weight:600; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  .bar { height:8px; width:90px; background:var(--line); border-radius:4px; overflow:hidden; display:inline-block; vertical-align:middle;}
  .bar > i { display:block; height:100%; }
  .reasons { color:var(--mut); font-size:12px; }
  .rung { font-size:11px; padding:1px 7px; border-radius:9px; border:1px solid var(--line); }
  .rung.shadow,.rung.block { color:var(--bad); border-color:var(--bad); }
  .rung.tarpit,.rung.pow { color:var(--warn); border-color:var(--warn); }
  button { font:inherit; cursor:pointer; background:var(--card); color:var(--fg);
           border:1px solid var(--line); border-radius:6px; padding:3px 8px; }
  button:hover { border-color:var(--accent); }
  .allow { color:var(--ok); } .block { color:var(--bad); }
  .crit td { background:rgba(248,81,73,.08); }
  .empty { color:var(--mut); padding:10px; }
  code { color:var(--accent); }
</style></head>
<body>
<header>
  <h1>🪞 MIRAGE</h1>
  <span class="pill" id="mode">loading…</span>
  <span class="pill" id="counts"></span>
</header>
<main>
  <section>
    <h2>Honeytoken trips</h2>
    <table id="trips"><thead><tr>
      <th>time</th><th>kind</th><th>from session</th><th>fingerprint</th><th>via</th><th>path</th>
    </tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Live sessions</h2>
    <table id="sessions"><thead><tr>
      <th>session</th><th>ip</th><th>ua</th><th>agent</th><th>hostile</th><th>score</th>
      <th>rung</th><th>reqs</th><th>why</th><th>action</th>
    </tr></thead><tbody></tbody></table>
  </section>
</main>
<script>
function barColor(v){ return v>=82?'var(--bad)':v>=55?'var(--warn)':'var(--ok)'; }
function bar(v){ return '<span class="bar"><i style="width:'+v+'%;background:'+barColor(v)+'"></i></span> '+v; }
function esc(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
async function act(id,v){ await fetch('api/action',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({session:id,verdict:v})}); refresh(); }
async function refresh(){
  try {
    const [ss,ts] = await Promise.all([
      fetch('api/sessions').then(r=>r.json()), fetch('api/trips').then(r=>r.json())]);
    const tb = document.querySelector('#sessions tbody'); tb.innerHTML='';
    if(!ss.length){ tb.innerHTML='<tr><td colspan=10 class=empty>no sessions yet</td></tr>'; }
    for(const s of ss){
      const tr=document.createElement('tr');
      const btns = s.verdict==='allow' ? '<span class=allow>allowed</span>'
                 : s.verdict==='block' ? '<span class=block>blocked</span>'
                 : '<button class=allow onclick="act(\''+s.id+'\',\'allow\')">allow</button> '+
                   '<button class=block onclick="act(\''+s.id+'\',\'block\')">block</button>';
      tr.innerHTML='<td><code>'+esc(s.id)+'</code></td><td>'+esc(s.ip)+'</td><td>'+esc(s.ua)+'</td>'+
        '<td>'+bar(s.agent)+'</td><td>'+bar(s.hostile)+'</td><td>'+bar(s.score)+'</td>'+
        '<td><span class="rung '+esc(s.rung)+'">'+esc(s.rung)+'</span></td><td>'+s.reqs+'</td>'+
        '<td class=reasons>'+(s.reasons||[]).map(esc).join('<br>')+'</td><td>'+btns+'</td>';
      tb.appendChild(tr);
    }
    const tt=document.querySelector('#trips tbody'); tt.innerHTML='';
    if(!ts.length){ tt.innerHTML='<tr><td colspan=6 class=empty>no trips — good (or shadow is off)</td></tr>'; }
    for(const t of ts){
      const tr=document.createElement('tr'); tr.className='crit';
      tr.innerHTML='<td>'+esc(t.at)+'</td><td>'+esc(t.kind)+'</td><td><code>'+esc(t.from_session)+'</code></td>'+
        '<td>'+esc(t.from_fp)+'</td><td>'+esc(t.via)+'</td><td>'+esc(t.path)+'</td>';
      tt.appendChild(tr);
    }
    document.getElementById('counts').textContent = ss.length+' sessions · '+ts.length+' trips';
  } catch(e){ /* keep last view */ }
}
refresh(); setInterval(refresh, 2000);
</script>
</body></html>`
