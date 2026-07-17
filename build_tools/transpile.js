// Precompiles the app's JSX to plain JS at build time using the same
// babel-standalone the site previously ran in-browser on every launch.
// Usage: node transpile.js <in.js> <out.js>
const fs = require("fs");
const Babel = require("./babel.min.js");
const src = fs.readFileSync(process.argv[2], "utf8");
const out = Babel.transform(src, { presets: ["react"], compact: false }).code;
fs.writeFileSync(process.argv[3], out);
console.log("transpiled " + Math.round(out.length / 1024) + " KB");
