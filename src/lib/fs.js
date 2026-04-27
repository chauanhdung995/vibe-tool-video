const fs = require('fs/promises');
const path = require('path');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    // SyntaxError: file bị corrupt hoặc đọc trúng lúc đang write
    // Trả về fallback thay vì crash server
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  // Ghi ra file tạm rồi rename — rename là atomic trên cùng filesystem,
  // đảm bảo reader không bao giờ thấy file nửa chừng
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

module.exports = {
  ensureDir,
  readJson,
  writeJson,
  exists,
  removePath
};
