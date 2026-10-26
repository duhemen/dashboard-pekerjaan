const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
const filesToResize = [
  'icon.png',
  'adaptive-icon.png',
  'favicon.png',
  'splash-icon.png'
];

async function processImages() {
  for (const file of filesToResize) {
    const filePath = path.join(assetsDir, file);
    
    if (fs.existsSync(filePath)) {
      console.log(`Memproses: ${file}...`);
      
      // Simpan ke file sementara dulu
      const tempPath = filePath + '.tmp';
      
      // Ubah ukuran menjadi 1024x1024 (persegi) dan timpa file asli
      await sharp(filePath)
        .resize(1024, 1024, {
          fit: 'contain', // Memastikan gambar tidak gepeng
          background: { r: 15, g: 23, b: 42, alpha: 0 } // Background transparan (#0f172a)
        })
        .toFile(tempPath);
        
      // Ganti file lama dengan yang baru
      fs.renameSync(tempPath, filePath);
      console.log(`✅ Selesai: ${file} (1024x1024)`);
    } else {
      console.log(`⚠️ File tidak ditemukan: ${file}`);
    }
  }
}

processImages().catch(console.error);