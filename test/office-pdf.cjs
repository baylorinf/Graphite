'use strict';
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');

// node test/office-pdf.cjs [--installed] [--app <unpacked directory>]
// Real rendering optionally uses Word, PowerPoint, and a test-only Python with python-docx/python-pptx/pypdf.
const arg = process.argv.indexOf('--app');
const repo = arg < 0 ? path.resolve(__dirname,'..') : path.resolve(process.argv[arg+1]);
const scripts = path.join(repo,'extensions/claude-code/skills/obsidian-import/scripts');
const python = process.env.GRAPHITE_OFFICE_TEST_PYTHON || path.join(process.env.USERPROFILE || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const installed = process.argv.includes('--installed');
const samplePdf = Buffer.from('%PDF-1.7\nA synthetic cache fixture\n%%EOF\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function run(file,args,options = {}) {
  const p = cp.spawnSync(file,args,{windowsHide:true,encoding:'utf8',timeout:60000,...options});
  if (p.status !== 0) throw Error((p.error?.message || p.stderr || 'Process failed').slice(0,600));
  return p.stdout.trim();
}
function officeState() {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$ids=@(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})",
    "$n=$null;$w=$null",
    "try{$a=[Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $n=$a.Presentations.Count;$w=$a.Windows.Count;[void][Runtime.InteropServices.Marshal]::ReleaseComObject($a)}catch{}",
    "[Console]::WriteLine((@{ids=$ids;presentations=$n;windows=$w}|ConvertTo-Json -Compress))",
  ].join('\n');
  return JSON.parse(run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]));
}
function createFixtures(vault) {
  run(python,['-c',[
    'from docx import Document','from pptx import Presentation','from pathlib import Path','import sys',
    'p=Path(sys.argv[1]);d=Document();d.add_paragraph("GRAPHITE WORD CONTENT");d.save(p/"资料 A [一].docx")',
    'r=Presentation();s=r.slides.add_slide(r.slide_layouts[0]);s.shapes.title.text="GRAPHITE SLIDE CONTENT";r.save(p/"课件 B [二].pptx")',
  ].join('\n'),vault],{env:{...process.env,PYTHONIOENCODING:'utf-8'}});
}
function printedText(pdf) {
  return run(python,['-c','from pypdf import PdfReader;import sys;r=PdfReader(sys.argv[1]);assert len(r.pages)==1;print(r.pages[0].extract_text())',pdf],
    {env:{...process.env,PYTHONIOENCODING:'utf-8'}});
}

async function main() {
  if (process.platform !== 'win32') {console.log('SKIP Windows Office integration');return;}
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-office-qa-'));
  const vault = path.join(dir,'课程 资料');
  await fs.mkdir(vault);
  let launches = 0, failure = false;
  if (!installed) {
    // A worker fixture lets a host without Office test cache races and the missing-application path.
    cp.spawn = (_exe,_args,options) => {
      const proc = new EventEmitter();proc.stdout=new PassThrough();proc.kill=()=>{};
      assert.equal(options.env.GRAPHITE_SRC,path.resolve(options.env.GRAPHITE_SRC));
      assert.equal(options.env.GRAPHITE_OUT,path.resolve(options.env.GRAPHITE_OUT));
      launches++;
      setTimeout(async()=>{
        try {
          await fs.writeFile(options.env.GRAPHITE_OUT,failure ? 'incomplete output' : samplePdf);
          proc.stdout.end(JSON.stringify(failure ? {ok:false,code:'officeUnavailable',hresult:'0x80040154'} : {ok:true}));
          proc.emit('close',failure?1:0);
        } catch(e) {proc.emit('error',e);}
      },30);
      return proc;
    };
  }
  const core = require(path.join(scripts,'office-pdf.cjs'));
  const file = '资料 A [一].docx', deck = '课件 B [二].pptx';
  const native = path.join(vault,file);
  try {
    if (installed) createFixtures(vault);
    else for (const n of [file,deck]) await fs.writeFile(path.join(vault,n),'Synthetic Office input');
    const sourceDigest = hash(await fs.readFile(native));
    const port = await require(path.join(repo,'server.js')).start({vault});
    const preview = async (name,save=false) => {
      const q=new URLSearchParams({path:name,save:save?'1':'0'});
      const res=await fetch('http://127.0.0.1:'+port+'/api/office-pdf?'+q,{method:'POST',headers:{'X-Vault':'1'}});
      return {status:res.status,...await res.json()};
    };
    const missing=await preview('移走的文件.docx');
    assert.equal(missing.status,404);assert.equal(missing.code,'officeSourceMissing');
    const a=await Promise.all([preview(file),preview(file),preview(file)]);
    assert.ok(a.every(r=>r.status===200 && r.pdf===a[0].pdf),JSON.stringify(a));
    if (!installed)assert.equal(launches,1);
    const cached=path.join(vault,a[0].pdf);
    assert.ok(await core.isPdf(cached));
    if (installed) assert.match(printedText(cached),/GRAPHITE WORD CONTENT/);
    await fs.utimes(cached,new Date(1000),new Date(1000));
    assert.equal((await preview(file)).pdf,a[0].pdf);
    assert.equal((await fs.stat(cached)).mtimeMs,1000);
    // All clients of the cache share a single independently validated PDF. Existing originals and PDF copies survive.
    const previous=path.join(vault,file.replace('.docx','.pdf'));await fs.writeFile(previous,'previous pdf');
    const saved=await Promise.all([preview(file,true),preview(file,true)]);
    assert.equal(new Set(saved.map(r=>r.saved)).size,2);
    assert.equal(await fs.readFile(previous,'utf8'),'previous pdf');
    for(const r of saved) {assert.equal(r.status,200);assert.deepEqual(await fs.readFile(path.join(vault,r.saved)),await fs.readFile(cached));}
    console.log('PASS simultaneous previews, saved copies, cached reopening and missing input');
    await fs.writeFile(cached,'%PDF-broken');
    if (!installed) {
      failure=true;
      const err=await preview(file);assert.equal(err.status,501);assert.equal(err.code,'officeUnavailable');
      assert.ok(err.error.includes(file)&&!err.error.includes('\uFFFD'));
      assert.equal(await fs.readFile(cached,'utf8'),'%PDF-broken','failed render published partial PDF');
      failure=false;
    }
    assert.equal((await preview(file)).status,200);assert.ok(await core.isPdf(cached));
    assert.equal(hash(await fs.readFile(native)),sourceDigest);
    if (!installed) { console.log('PASS Office failure classification, atomic publication and cache repair');return; }
    const before=officeState(),pptPath=path.join(vault,deck),edited=hash(await fs.readFile(pptPath));
    const pptOut=await core.officeToPdf(pptPath.replaceAll('\\','/'),path.join(vault,'直接 导出.pdf').replaceAll('\\','/'));
    assert.match(printedText(pptOut),/GRAPHITE SLIDE CONTENT/);
    assert.equal(hash(await fs.readFile(pptPath)),edited);
    const fromDoc=await core.officeToPdf(native.replaceAll('\\','/'),path.join(vault,'直接 Word 导出.pdf').replaceAll('\\','/'));
    assert.match(printedText(fromDoc),/GRAPHITE WORD CONTENT/);
    const after=officeState();
    for(const id of before.ids) assert.ok(after.ids.includes(id),'pre-existing PowerPoint process disappeared');
    if(before.presentations!=null) assert.equal(after.presentations,before.presentations);
    if(before.windows!=null) assert.equal(after.windows,before.windows);
    console.log('PASS real Word and PowerPoint rendering with Chinese, spaces, brackets and forward slashes',JSON.stringify({before,after}));
    for(const ext of ['docx','pptx']) {
      const bad='损坏 文档.'+ext;await fs.writeFile(path.join(vault,bad),'invalid package');
      const r=await preview(bad);assert.equal(r.status,422,JSON.stringify(r));assert.equal(r.code,'officeInvalidDocument');
      assert.ok(r.error.includes(bad)&&!r.error.includes('\uFFFD'));
    }
    const plan=path.join(dir,'plan.json');
    await fs.writeFile(plan,JSON.stringify({items:[{src:native.replaceAll('\\','/'),dest:'归档/讲义.pdf'},{src:pptPath.replaceAll('\\','/'),dest:'归档/讲义.pdf'}]}));
    const imported=JSON.parse(run(process.execPath,[path.join(scripts,'import.js'),plan],{env:{...process.env,OBSIDIAN_VAULT:vault,GRAPHITE_CONFIG:path.join(dir,'unused.json')}}));
    assert.equal(imported.failed.length,0,JSON.stringify(imported));
    assert.deepEqual(imported.done.map(r=>r.dest),['归档/讲义.pdf','归档/讲义 1.pdf']);
    assert.match(printedText(path.join(vault,imported.done[0].dest)),/GRAPHITE WORD CONTENT/);
    assert.match(printedText(path.join(vault,imported.done[1].dest)),/GRAPHITE SLIDE CONTENT/);
    console.log('PASS invalid files and bundled Claude import with colliding output names');
  } finally {
    await fs.rm(dir,{recursive:true,force:true,maxRetries:4});
  }
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
