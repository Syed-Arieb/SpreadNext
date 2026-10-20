export function exportFileName(title: string, extension: string): string {
  let name = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .slice(0, 120)
    .replace(/[. ]+$/g, '');

  if (!name) {
    name = 'Untitled spreadsheet';
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
    name = `_${name}`;
  }

  return `${name}.${extension}`;
}
