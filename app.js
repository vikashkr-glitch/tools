// app.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const cors = require('cors');
const path = require('path');

const upload = multer({ dest: 'uploads/' , limits: { fileSize: 200 * 1024 * 1024 } }); // 200 MB limit
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve a small static frontend for test (optional)
app.use('/', express.static(path.join(__dirname, 'public')));

// Endpoint: upload and crop
// Accepts form-data: file (pdf), and JSON fields: page (0-based), x, y, w, h
app.post('/crop', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const pageIndex = Number(req.body.page || 0);
    const cropX = Number(req.body.x || 0);
    const cropY = Number(req.body.y || 0);
    const cropW = Number(req.body.w || 0);
    const cropH = Number(req.body.h || 0);

    // basic validation
    if (isNaN(pageIndex) || isNaN(cropX) || isNaN(cropY) || isNaN(cropW) || isNaN(cropH)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid crop parameters' });
    }

    const existingPdfBytes = fs.readFileSync(req.file.path);
    const srcPdf = await PDFDocument.load(existingPdfBytes);
    const outPdf = await PDFDocument.create();

    if (pageIndex < 0 || pageIndex >= srcPdf.getPageCount()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Page index out of bounds' });
    }

    // embed the selected page into the new doc
    // pdf-lib provides embedPages which accepts pages from another PDF
    const [embeddedPage] = await outPdf.embedPages([srcPdf.getPage(pageIndex)]);

    // create a new page of size cropW x cropH
    const targetWidth = Math.max(1, Math.round(cropW));
    const targetHeight = Math.max(1, Math.round(cropH));
    const newPage = outPdf.addPage([targetWidth, targetHeight]);

    // Draw the embedded page onto the new page shifted by negative offsets
    // so that only the requested crop rectangle appears on the new page.
    // Note: coordinate origin in PDFs is bottom-left; common UIs use top-left.
    // Our API expects x,y as pixels from top-left of the original page (like typical UI).
    // So we convert y accordingly.
    const srcPage = srcPdf.getPage(pageIndex);
    const srcWidth = srcPage.getSize().width;
    const srcHeight = srcPage.getSize().height;

    // If user provided y as top-based coordinate, convert:
    // convert top-left y to bottom-left origin used by pdf-lib:
    const y_from_bottom = srcHeight - cropY - cropH;

    // Draw with offsets: we shift embedded page by -cropX, -y_from_bottom
    newPage.drawPage(embeddedPage, {
      x: -cropX,
      y: -y_from_bottom,
      width: srcWidth,
      height: srcHeight,
    });

    const outBytes = await outPdf.save();

    // cleanup
    fs.unlinkSync(req.file.path);

    // send as attachment
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="cropped.pdf"');
    return res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PDF crop server listening on port ${PORT}`));
