const fs = require('fs');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#6366f1"/><text x="50" y="50" font-family="Arial, sans-serif" font-size="65" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">D</text></svg>`;

// Simpan sebagai SVG ke folder public
fs.writeFileSync('public/favicon.svg', svg);
console.log('✅ public/favicon.svg berhasil dibuat!');