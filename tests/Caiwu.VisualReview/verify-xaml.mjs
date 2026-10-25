// Guard the boundaries of a visual-only change against a known behavior-owning base.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseline = process.argv[2] || '6a155a5b2deec55bbf0fe8ac9fbc3e0903750ac5';
const files = ['src/Caiwu.Desktop/MainWindow.xaml', 'src/Caiwu.Desktop/Dialogs/VoucherEditorWindow.xaml', 'src/Caiwu.Desktop/Dialogs/ReportCenterWindow.xaml'];
let failures = 0;
const values = (text, regex) => [...text.matchAll(regex)].map(m => m[1] ?? m[0]).sort();
for (const file of files) {
  const before = execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  for (const [kind, regex] of [
    ['operation labels', /<(?:Button|MenuItem)\b[^>]*\b(?:Content|Header)="([^"]*)"/g],
    ['names', /\bx:Name="[^"]*"/g],
    ['automation IDs', /\bAutomationProperties.AutomationId="[^"]*"/g],
    ['bindings', /"\{Binding[^\"]*\}"/g],
    ['event handlers', /\b[A-Za-z]+="[A-Za-z0-9]+_[A-Za-z0-9_]+"/g],
    ['write-operation guards', /\bTag="WriteOperation"/g],
  ]) {
    if (JSON.stringify(values(before, regex)) !== JSON.stringify(values(after, regex))) {
      console.error(`FAIL ${file}: ${kind} differ from behavior baseline ${baseline}`); failures++;
    }
  }
}
if (failures) process.exit(1);
console.log(`PASS: original operation labels, names, automation IDs, bindings, event handlers and write-operation tags preserved in ${files.length} XAML files against ${baseline}.`);
