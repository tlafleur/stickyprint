// Copies the pinned jsPDF browser bundle from node_modules into vendor/.
// Run after changing the jspdf version in package.json, then update the
// <script> tag in index.html to match.
import { copyFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/jspdf/package.json', 'utf8'));
const dest = `vendor/jspdf-${version}.umd.min.js`;
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', dest);
console.log(`Copied jsPDF ${version} to ${dest}`);
