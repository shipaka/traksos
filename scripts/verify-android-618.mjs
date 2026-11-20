import { readFileSync } from 'node:fs';
const css = readFileSync('web/src/androidDesignReview.css', 'utf8');
const preview = readFileSync('web/src/screens/androidDesignReview.tsx', 'utf8');
const workspaces = readFileSync('web/src/screens/androidWorkspaces.tsx', 'utf8');
const catalog = readFileSync('web/src/vehiclePhotoCatalog.ts', 'utf8');
function must(condition, message) { if (!condition) throw Error('Android 618: ' + message); }
must(/role-client \.and19-review-tabbar\s*\{[^}]*grid-template-columns:repeat\(5,/.test(css),
  'owner and driver must have five CSS columns, not six');
must(/vehicle: \{ brand: 'Scania', model: 'R440', year: 2010 \}/.test(preview),
  'approved reference must remain Scania R440 (2010)');
must(!/vehicle: \{ brand: 'Scania', model: 'R520', year: 2019 \}/.test(preview),
  'do not substitute a Next Gen R520 for an R440');
must(workspaces.includes('className="and19-order-photo-link"') &&
     workspaces.includes('ApprovedOrderTruck order={current}'),
  'vehicle photo must remain a real interactive order component');
must(catalog.includes('modelPattern:/^r520') &&
     !catalog.includes("modelPattern:/^r440"),
  'do not claim an R440 photograph before the licensed, plate-redacted asset exists');
console.log('Android 618 source guards PASS: five tabs, real workspace, safe R440 fallback');
