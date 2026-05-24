const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'frontend/src');

function getAllFiles(dirPath, arrayOfFiles) {
  files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.jsx') || file.endsWith('.js') || file.endsWith('.html')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

const files = getAllFiles(srcDir);
const classSet = new Set();
const classRegex = /className=["']([^"']+)["']/g;
const classRegex2 = /className=\{`([^`]+)`\}/g; // basic template literals
// For HTML
const htmlClassRegex = /class=["']([^"']+)["']/g;

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  let match;
  
  while ((match = classRegex.exec(content)) !== null) {
    const classes = match[1].split(/\s+/);
    classes.forEach(c => c.trim() && classSet.add(c.trim()));
  }

  while ((match = classRegex2.exec(content)) !== null) {
    const classes = match[1].split(/\s+/);
    classes.forEach(c => {
      // remove variables like ${...}
      let clean = c.trim().replace(/\$\{[^}]+\}/g, '');
      if (clean) classSet.add(clean);
    });
  }

  while ((match = htmlClassRegex.exec(content)) !== null) {
    const classes = match[1].split(/\s+/);
    classes.forEach(c => c.trim() && classSet.add(c.trim()));
  }
});

const bootstrapPrefixes = ['btn', 'col', 'row', 'container', 'd-', 'm-', 'p-', 'text-', 'bg-', 'align-', 'justify-', 'shadow', 'card', 'rounded', 'fs-', 'fw-'];
const categories = {
  bootstrap: [],
  custom: []
};

classSet.forEach(c => {
  let isBootstrap = false;
  for (let prefix of bootstrapPrefixes) {
    if (c.startsWith(prefix) || c === prefix) {
      isBootstrap = true;
      break;
    }
  }
  if (isBootstrap) {
    categories.bootstrap.push(c);
  } else {
    categories.custom.push(c);
  }
});

fs.writeFileSync(path.join(__dirname, 'frontend_classes_summary.md'), 
`# Frontend Classes Summary

## Bootstrap Classes (${categories.bootstrap.length})
${categories.bootstrap.sort().map(c => '- `' + c + '`').join('\n')}

## Custom/Other Classes (${categories.custom.length})
${categories.custom.sort().map(c => '- `' + c + '`').join('\n')}
`);

console.log("Summary created at frontend_classes_summary.md");
