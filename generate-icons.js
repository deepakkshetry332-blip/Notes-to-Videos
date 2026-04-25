// Run with: node generate-icons.js
// Generates icons/icon-192.png and icons/icon-512.png

const { createCanvas } = require(‘canvas’);
const fs = require(‘fs’);

if (!fs.existsSync(‘icons’)) fs.mkdirSync(‘icons’);

function generateIcon(size) {
const canvas = createCanvas(size, size);
const ctx = canvas.getContext(‘2d’);

// Background
ctx.fillStyle = ‘#0a0a0f’;
ctx.fillRect(0, 0, size, size);

// Film strip holes
ctx.fillStyle = ‘#ffffff15’;
const holeSize = size * 0.06;
const holeY = size * 0.1;
for (let i = 0; i < 4; i++) {
const x = size * 0.1 + i * (size * 0.22);
ctx.beginPath();
ctx.roundRect(x, holeY, holeSize * 1.4, holeSize, 2);
ctx.fill();
}

// “NF” text
ctx.fillStyle = ‘#e8b84b’;
ctx.font = `bold ${size * 0.45}px serif`;
ctx.textAlign = ‘center’;
ctx.textBaseline = ‘middle’;
ctx.fillText(‘NF’, size / 2, size * 0.55);

// Bottom accent bar
ctx.fillStyle = ‘#e8b84b’;
ctx.fillRect(size * 0.15, size * 0.82, size * 0.7, size * 0.04);

return canvas.toBuffer(‘image/png’);
}

fs.writeFileSync(‘icons/icon-192.png’, generateIcon(192));
fs.writeFileSync(‘icons/icon-512.png’, generateIcon(512));
console.log(‘Icons generated: icons/icon-192.png, icons/icon-512.png’);