'use strict';
const { parseDocument, DomUtils } = require('htmlparser2');

const site = 'https://oc.sjtu.edu.cn';
const block = new Set(['p','div','br','h1','h2','h3','h4','h5','h6','li','ol','ul','blockquote','tr','pre']);
const hidden = new Set(['script','style','template','noscript','iframe']);

function courseContent(html, courseId) {
  const root = parseDocument(String(html || ''));
  const text = [], attachments = new Map();
  const stack = [{ node: root }];
  while (stack.length) {
    const { node, closing } = stack.pop();
    const tag = node.name;
    if (closing) {
      if (block.has(tag)) text.push('\n');
      else if (tag === 'td' || tag === 'th') text.push('\t');
      continue;
    }
    if (hidden.has(tag) || node.attribs?.hidden !== undefined || node.attribs?.['aria-hidden'] === 'true') continue;
    if (node.type === 'text') { text.push(node.data.replace(/\s+/g,' ')); continue; }
    if (block.has(tag)) text.push('\n');
    if (tag === 'li') text.push('• ');
    if (tag === 'img' && node.attribs.alt) text.push(node.attribs.alt);
    if (tag === 'a' || tag === 'img') {
      const attr = node.attribs;
      for (const raw of [attr.href || attr.src, attr['data-api-endpoint']]) {
        if (!raw) continue;
        let url;
        try { url = new URL(raw, site + '/courses/' + courseId + '/'); } catch { continue; }
        if (url.origin !== site || url.username || url.password) continue;
        const m = /^(?:\/api\/v1)?(?:\/courses\/(\d+))?\/files\/(\d+)(?:\/(?:download|preview))?\/?$/.exec(url.pathname);
        if (!m || (m[1] && m[1] !== String(courseId))) continue;
        const id = m[2];
        const name = attr.title || attr.alt || DomUtils.textContent(node).trim() || 'File ' + id;
        attachments.set(id,{ id, name, url: site + '/courses/' + courseId + '/files/' + id });
        break;
      }
    }
    if (!node.children) continue;
    stack.push({ node, closing:true });
    for (let n=node.children.length-1;n>=0;n--) stack.push({node:node.children[n]});
  }
  return { text:text.join('').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g,'\n\n').trim(),
    attachments:[...attachments.values()] };
}

module.exports = { courseContent };
