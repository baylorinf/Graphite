'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');

const messages = {
  officeSourceMissing: [404, '找不到源文件。请重新扫描或确认文件是否已移动。'],
  officeSourceUnreadable: [403, '无法读取源文件。请检查读取权限或云盘文件是否已下载。'],
  officeInvalidDocument: [422, '文件为空、格式与扩展名不符或文档已损坏。'],
  officeProtected: [422, '文件使用了加密或旧版容器。请先在 Office 中打开并另存为未加密的文档。'],
  officeUnavailable: [501, '无法启动桌面版 Office。请检查对应应用是否已安装且能正常打开。'],
  officeOpenFailed: [422, '已找到文件，但 Office 无法打开。请在对应应用中检查文档。'],
  officeExportFailed: [500, 'Office 未能生成完整的 PDF。请检查磁盘空间和目标目录的写入权限。'],
  officeTimeout: [504, '转换超时。请在对应应用中检查文件是否需要密码或手动修复。'],
};
function error(code, source, hresult) {
  const [status, reason] = messages[code] || messages.officeExportFailed;
  const app = /\.pptx?$/i.test(source) ? 'PowerPoint' : 'Word';
  const hint = /^0x[\dA-F]{8}$/i.test(hresult || '') ? ' (' + hresult + ')' : '';
  return Object.assign(new Error(app + ' · ' + path.basename(source) + '：' + reason + hint), { code, status });
}

async function isPdf(file) {
  let fd;
  try {
    fd = await fsp.open(file,'r');
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size < 12) return false;
    const head = Buffer.alloc(5), tail = Buffer.alloc(Math.min(1024,stat.size));
    await fd.read(head,0,head.length,0);
    await fd.read(tail,0,tail.length,stat.size-tail.length);
    return head.toString('ascii') === '%PDF-' && tail.includes(Buffer.from('%%EOF'));
  } catch (e) { if(e.code === 'ENOENT') return false; throw e; }
  finally { if(fd) await fd.close(); }
}

let command;
function convert(source, output) {
  if (process.platform !== 'win32') return Promise.reject(error('officeUnavailable', source));
  // Windows PowerShell's -Command string is limited by command-line quoting and the host code page.
  // -EncodedCommand reads the bundled script directly even inside Electron's app.asar.
  command ||= Buffer.from(fs.readFileSync(path.join(__dirname,'office2pdf.ps1'),'utf8'),'utf16le').toString('base64');
  return new Promise((resolve,reject) => {
    const ps = spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],
      {env:{...process.env,GRAPHITE_SRC:source,GRAPHITE_OUT:output},windowsHide:true,stdio:['ignore','pipe','ignore']});
    let text = '', timedOut = false;
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', chunk => { text = (text + chunk).slice(-32768); });
    const timer = setTimeout(() => { timedOut = true; ps.kill(); },180000);
    ps.on('error', () => { clearTimeout(timer); reject(error('officeUnavailable',source)); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(error('officeTimeout',source));
      let result;
      try { result = JSON.parse(text.trim()); } catch { /* Host did not reach the structured result. */ }
      if (code === 0 && result?.ok) return resolve();
      reject(error(Object.hasOwn(messages,result?.code) ? result.code : 'officeExportFailed',source,result?.hresult));
    });
  });
}

let queue = Promise.resolve();
async function copyPdfNew(file, requested) {
  const ext = path.extname(requested), base = requested.slice(0, requested.length - ext.length);
  for (let i = 0; ; i++) {
    const dest = i ? base + ' ' + i + ext : requested;
    try { await fsp.copyFile(file,dest,fs.constants.COPYFILE_EXCL); return dest; }
    catch(e) { if(e.code !== 'EEXIST') throw e; }
  }
}
function officeToPdf(input, output, { asNew = false } = {}) {
  const source = path.resolve(input), dest = path.resolve(output);
  const task = queue.then(async () => {
    let st;
    try { st = await fsp.stat(source); }
    catch(e){ throw error(['ENOENT','ENOTDIR'].includes(e.code) ? 'officeSourceMissing' : 'officeSourceUnreadable',source); }
    if (!st.isFile() || !st.size) throw error('officeInvalidDocument',source);
    let temp;
    try {
      await fsp.mkdir(path.dirname(dest),{recursive:true});
      temp = await fsp.mkdtemp(path.join(path.dirname(dest),'.graphite-office-'));
      const pdf = path.join(temp,'converted.pdf');
      await convert(source,pdf);
      if (!await isPdf(pdf)) throw error('officeExportFailed',source);
      if (asNew) return await copyPdfNew(pdf,dest);
      await fsp.rename(pdf,dest);
      return dest;
    } catch(e) { if(Object.hasOwn(messages,e.code))throw e;throw error('officeExportFailed',source); }
    finally { if(temp) await fsp.rm(temp,{recursive:true,force:true,maxRetries:3}).catch(()=>{}); }
  });
  queue = task.catch(() => {});
  return task;
}

module.exports = { officeToPdf, isPdf, copyPdfNew, error };
