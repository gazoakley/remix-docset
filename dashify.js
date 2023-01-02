const fs = require('fs/promises');
const { join, relative } = require('path');
const Database = require('better-sqlite3');
const { marked } = require('marked');
const debug = require('debug')('remix-docset');
const dbDebug = require('debug')('better-sqlite3');

async function mkdir(options) {
  await fs.mkdir(`${options.docsetName}.docset/Contents/Resources/Documents`, { recursive: true });
}

async function generateHtml(options, path) {
  options.outputFiles = options.outputFiles || [];
  path = path || options.markdownPath;
  const entries = await fs.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await generateHtml(options, entryPath);
    } else {
      const markdown = await fs.readFile(entryPath, { encoding: 'utf-8' });
      const hiddenMatch = markdown.match(/^hidden:\s+(?<hidden>.*)$/m);
      if (hiddenMatch?.groups?.hidden === 'true') {
        continue;
      }
      const titleMatch = markdown.match(/^title:\s+(?<title>.*)$/m);
      const title = titleMatch?.groups?.title;
      debug("title", title);
      const markdownTrimmed = markdown.replace(/---(\s[^-].*)*\s---\s*/m, "").trim();
      if (markdownTrimmed === "") {
        debug("empty doc");
        continue;
      }
      const markdownHtml = await marked.parse(markdownTrimmed, { async: true });
      const relativePath = relative(options.markdownPath, entryPath).replace(/\.md$/, "");
      const onlineUrl = options.baseUrl + relativePath;
      debug("onlineUrl", onlineUrl)
      const html = `<html><!-- Online page at ${onlineUrl} --><head><title>${title}</title></head><body>${markdownHtml}</body></html>`;
      const type = Object.entries(options.types).find(([matcher]) => (new RegExp(matcher)).test(relativePath))?.[1] || "Guide";
      debug(type);
      const filePath = `${options.outputFiles.length}.html`; // relativePath === "index" ? "index.html" : 
      debug("filePath", filePath);
      const outputPath = `${options.docsetName}.docset/Contents/Resources/Documents/${filePath}`;
      fs.writeFile(outputPath, html, { encoding: 'utf-8' });
      options.outputFiles.push({
        name: title,
        type,
        path: filePath,
      })
    }
  }
}

async function generatePlist(options) {
  const dictXml = Object.entries(options.plist).reduce((xml, [key, value]) => {
    xml += `  <key>${key}</key>\n`;
    if (typeof (value) === 'boolean') {
      xml += `  <${value.toString()}/>\n`;
    } else {
      xml += `  <string>${value}</string>\n`;
    }
    return xml;
  }, "");
  const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${dictXml}</dict>
</plist>`;
  await fs.writeFile(`${options.docsetName}.docset/Contents/Info.plist`, plistXml, { encoding: 'utf-8' });
}

async function generateSqlite(options) {
  const db = new Database(`${options.docsetName}.docset/Contents/Resources/docSet.dsidx`, { verbose: dbDebug });
  db.exec("CREATE TABLE searchIndex(id INTEGER PRIMARY KEY, name TEXT, type TEXT, path TEXT);");
  db.exec("CREATE UNIQUE INDEX anchor ON searchIndex (name, type, path);");
  const stmt = db.prepare('INSERT INTO searchIndex (name, type, path) VALUES (?, ?, ?)');
  for (const outputFile of options.outputFiles) {
    stmt.run(outputFile.name, outputFile.type, outputFile.path);
  }
  db.close();
}

async function addIcon(options) {
  await fs.copyFile(options.iconPath, `${options.docsetName}.docset/icon.png`);
}

async function dashify() {
  const options = JSON.parse(await fs.readFile(process.argv[2]));
  await mkdir(options);
  await generateHtml(options);
  await generatePlist(options);
  await generateSqlite(options);
  await addIcon(options);
}

(async () => await dashify())();
