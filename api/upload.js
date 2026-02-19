import { IncomingForm } from 'formidable';
import { readFile } from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import FormData from 'form-data';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Disable bodyParser untuk formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Upload to cdn.yupra.my.id (PRIMARY - UTAMA)
 * @param {Buffer} content File Buffer
 * @return {Promise<string>}
 */
const uploadYupra = async (content) => {
  try {
    const { ext, mime } = (await fileTypeFromBuffer(content)) || {};
    const randomBytes = crypto.randomBytes(5).toString('hex');
    const formData = new FormData();
    
    // Buat filename dengan extension yang benar
    const filename = `${randomBytes}.${ext || 'bin'}`;
    formData.append('files', content, filename);
    
    console.log('📤 Uploading to cdn.yupra.my.id...', filename);
    
    const response = await fetch(
      "https://cdn.yupra.my.id/upload",
      {
        method: "POST",
        body: formData,
        headers: {
          ...formData.getHeaders(),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    
    const result = await response.json();
    
    if (!result.success || !result.files || result.files.length === 0) {
      throw new Error("Invalid response from cdn.yupra.my.id");
    }
    
    // Format: https://cdn.yupra.my.id/yp/xxxxx.jpg
    const fullUrl = `https://cdn.yupra.my.id${result.files[0].url}`;
    
    console.log("✅ Uploaded to cdn.yupra.my.id successfully:", fullUrl);
    return fullUrl;
  } catch (error) {
    console.error("❌ Upload to cdn.yupra.my.id failed:", error.message || error);
    throw error;
  }
};

/**
 * Upload to catbox.moe (FALLBACK - CADANGAN)
 * @param {Buffer} content File Buffer
 * @return {Promise<string>}
 */
const uploadCatbox = async (content) => {
  try {
    const { ext, mime } = (await fileTypeFromBuffer(content)) || {};
    const randomBytes = crypto.randomBytes(5).toString('hex');
    const formData = new FormData();
    
    formData.append('fileToUpload', content, `${randomBytes}.${ext || 'bin'}`);
    formData.append('reqtype', 'fileupload');
    
    console.log('📤 Uploading to catbox.moe (FALLBACK)...');
    
    const response = await fetch(
      "https://catbox.moe/user/api.php",
      {
        method: "POST",
        body: formData,
        headers: {
          ...formData.getHeaders(),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    
    const result = await response.text();
    
    if (!result || !result.startsWith('http')) {
      throw new Error("Invalid response from catbox.moe");
    }
    
    console.log("✅ Uploaded to catbox.moe successfully:", result);
    return result;
  } catch (error) {
    console.error("❌ Upload to catbox.moe failed:", error.message || error);
    throw error;
  }
};

export default async function handler(req, res) {
  // Set response header untuk JSON SEJAK AWAL
  res.setHeader('Content-Type', 'application/json');

  // Cek method
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Cek authorization
  const authHeader = req.headers.authorization;
  if (authHeader !== 'admin-secret-key') {
    return res.status(403).json({ success: false, message: 'Tidak diizinkan' });
  }

  try {
    // Parse form dengan formidable
    const form = new IncomingForm({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      keepExtensions: true,
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('Formidable parse error:', err);
          reject(err);
        } else {
          resolve([fields, files]);
        }
      });
    });

    // Ambil file pertama
    const fileArray = files.file;
    if (!fileArray || fileArray.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diupload' });
    }

    const file = fileArray[0];
    console.log('📁 File received:', file.originalFilename, 'Size:', file.size, 'bytes');
    
    // Baca file sebagai buffer
    const fileBuffer = await readFile(file.filepath);

    // Validasi tipe file (hanya gambar)
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType || !fileType.mime.startsWith('image/')) {
      return res.status(400).json({ 
        success: false, 
        message: 'File harus berupa gambar (jpg, png, gif, webp)' 
      });
    }

    console.log('🖼️ File type detected:', fileType.mime);

    // ✅ UPLOAD STRATEGY: cdn.yupra.my.id PRIMARY -> catbox.moe FALLBACK
    let imageUrl;
    
    try {
      // TRY PRIMARY: cdn.yupra.my.id
      console.log('🎯 Trying PRIMARY: cdn.yupra.my.id...');
      imageUrl = await uploadYupra(fileBuffer);
      console.log('✅ PRIMARY upload successful!');
    } catch (primaryError) {
      // PRIMARY FAILED - TRY FALLBACK: catbox.moe
      console.log('⚠️ PRIMARY failed, trying FALLBACK: catbox.moe...');
      try {
        imageUrl = await uploadCatbox(fileBuffer);
        console.log('✅ FALLBACK upload successful!');
      } catch (fallbackError) {
        // BOTH FAILED
        console.error('❌ BOTH PRIMARY AND FALLBACK FAILED:', {
          primary: primaryError.message,
          fallback: fallbackError.message
        });
        return res.status(500).json({ 
          success: false, 
          message: 'Gagal mengupload ke semua layanan. Coba lagi nanti.',
          errors: {
            primary: primaryError.message,
            fallback: fallbackError.message
          }
        });
      }
    }

    // SUCCESS - Return JSON
    return res.status(200).json({ 
      success: true, 
      imageUrl: imageUrl,
      message: 'Upload berhasil' 
    });

  } catch (error) {
    console.error('❌ Upload handler error:', error);
    
    // PENTING: Selalu return JSON bahkan saat error
    return res.status(500).json({ 
      success: false, 
      message: 'Gagal mengupload gambar: ' + (error.message || 'Unknown error')
    });
  }
}
