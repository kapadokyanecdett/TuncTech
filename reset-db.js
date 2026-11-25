const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] !== "--confirm") {
  console.error("Veritabanını sıfırlamak için npm run db:reset komutunu kullanın.");
  process.exit(1);
}

const databasePath = path.join(__dirname, "data", "tunctech.sqlite");
for (const file of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

require("./db");
console.log("TunçTech veritabanı ilk verilerle yeniden oluşturuldu.");
